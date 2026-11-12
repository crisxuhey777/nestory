"""注册、登录、会话，以及把 AppState 存进 MySQL。

数据模型：
    users      账号 + 宝宝基础信息（邮箱、密码哈希、昵称、宝宝昵称/生日）
    sessions   会话（只存令牌的 SHA-256）
    user_state 每个用户一整份 AppState JSON（MVP 阶段整体读写，后续可拆表）

对外的状态码约定：
    400 参数不合法    401 未登录/密码错误    409 邮箱已注册
    503 MySQL 没起来
"""

from __future__ import annotations

import json
import logging
import re
import time
from contextlib import contextmanager
from datetime import date, datetime, timedelta

import pymysql

import auth
import db

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD = 8
log = logging.getLogger("nestory.auth")


def _mask_email(email: str) -> str:
    name, _, domain = email.partition("@")
    return f"{name[:1]}***@{domain}" if name else "(empty)"


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


@contextmanager
def _conn():
    try:
        conn = db.connect()
    except Exception as exc:  # noqa: BLE001 - 统一转成 503，前端好展示
        log.warning("db connect failed: %s: %s", type(exc).__name__, exc)
        raise ApiError(
            503, "db_unavailable", "MySQL 没有连上，请先启动数据库（3306）"
        ) from exc
    try:
        yield conn
    finally:
        conn.close()


def _s(value, fallback: str = "") -> str:
    return value.strip() if isinstance(value, str) else fallback


def _birthday(text) -> date:
    try:
        day = datetime.strptime(str(text or ""), "%Y-%m-%d").date()
    except (TypeError, ValueError):
        raise ApiError(400, "invalid_birthday", "宝宝生日格式应为 YYYY-MM-DD")
    if day > date.today():
        raise ApiError(400, "invalid_birthday", "宝宝生日不能是未来的日期")
    return day


def _ms_to_date(ms: int) -> date:
    return datetime.fromtimestamp(ms / 1000).date()


def _day_from_state(baby: dict) -> date | None:
    raw = baby.get("birthday")
    if not raw:
        return None
    if isinstance(raw, (int, float)):
        return _ms_to_date(int(raw))
    if isinstance(raw, str):
        try:
            return datetime.strptime(raw, "%Y-%m-%d").date()
        except ValueError:
            pass
    raise ApiError(400, "invalid_state", "state.baby.birthday should be YYYY-MM-DD")


def _seed_state(baby_name: str, birthday: date) -> dict:
    from app_state import build_state

    state = build_state()
    state["baby"]["name"] = baby_name
    state["baby"]["birthday"] = birthday.isoformat()
    return state


def _empty_state(baby_name: str = "", birthday: str = "") -> dict:
    from app_state import build_empty_state

    return build_empty_state(baby_name, birthday)



def _public_user(row: dict) -> dict:
    birthday = row.get("baby_birthday")
    return {
        "id": row["id"],
        "email": row["email"],
        "nickname": row["nickname"],
        "babyName": row["baby_name"],
        "babyBirthday": birthday.isoformat() if birthday else None,
        "createdAt": row["created_at"].isoformat(timespec="seconds")
        if row.get("created_at")
        else None,
    }


def _create_session(conn, user_id: int) -> str:
    token = auth.new_token()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (%s, %s, %s)",
            (auth.token_hash(token), user_id, auth.session_expiry()),
        )
        # 顺手清理这个用户已经过期的会话
        cur.execute(
            "DELETE FROM sessions WHERE user_id = %s AND expires_at <= NOW()", (user_id,)
        )
    return token


def _save_state(conn, user_id: int, state: dict, baby_name: str, birthday: date | None) -> None:
    payload = json.dumps(state, ensure_ascii=False, separators=(",", ":"))
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO user_state (user_id, state_json) VALUES (%s, %s)
            ON DUPLICATE KEY UPDATE state_json = VALUES(state_json)
            """,
            (user_id, payload),
        )
        cur.execute(
            "UPDATE users SET baby_name = %s, baby_birthday = %s WHERE id = %s",
            (baby_name, birthday, user_id),
        )


def _load_state(conn, row: dict) -> dict:
    with conn.cursor() as cur:
        cur.execute("SELECT state_json FROM user_state WHERE user_id = %s", (row["id"],))
        saved = cur.fetchone()
    if saved:
        try:
            state = json.loads(saved["state_json"])
            if isinstance(state, dict) and state.get("version") == 3:
                baby = state.get("baby") or {}
                raw = baby.get("birthday")
                if isinstance(raw, (int, float)):
                    # 早期版本把生日存成了毫秒，读出来时顺手修正并落库
                    baby["birthday"] = _ms_to_date(int(raw)).isoformat()
                    log.info("migrated baby.birthday user=%s %s -> %s", row["id"], raw, baby["birthday"])
                    _save_state(
                        conn,
                        row["id"],
                        state,
                        row.get("baby_name") or "宝宝",
                        row.get("baby_birthday") or date.today(),
                    )
                return state
        except json.JSONDecodeError:
            pass

    # 老账号或数据损坏：建一份空状态，不再注入演示数据
    birthday = row.get("baby_birthday")
    state = _empty_state(
        row.get("baby_name") or "",
        birthday.isoformat() if birthday else "",
    )
    _save_state(conn, row["id"], state, row.get("baby_name") or "", birthday)
    return state


def _user_row_by_email(conn, email: str) -> dict | None:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM users WHERE email = %s", (email,))
        return cur.fetchone()


def _user_row_by_token(conn, token: str) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT u.* FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = %s AND s.expires_at > NOW()
            LIMIT 1
            """,
            (auth.token_hash(token),),
        )
        return cur.fetchone()


def register(data: dict) -> tuple[dict, dict, str]:
    email = _s(data.get("email")).lower()
    password = data.get("password") or ""
    nickname = _s(data.get("nickname")) or email.split("@")[0]

    if not EMAIL_RE.match(email) or len(email) > 190:
        raise ApiError(400, "invalid_email", "invalid email")
    if len(password) < MIN_PASSWORD:
        raise ApiError(400, "weak_password", f"password needs at least {MIN_PASSWORD} characters")
    if len(nickname) > 60:
        raise ApiError(400, "invalid_name", "nickname is too long")

    state = _empty_state()

    with _conn() as conn:
        if _user_row_by_email(conn, email):
            raise ApiError(409, "email_exists", "email already registered")
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO users (email, password_hash, nickname, baby_name, baby_birthday)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (email, auth.hash_password(password), nickname, "", None),
            )
            user_id = cur.lastrowid
        _save_state(conn, user_id, state, "", None)
        token = _create_session(conn, user_id)
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()
    log.info("register user=%s email=%s", user_id, _mask_email(email))
    return _public_user(row), state, token



def login(data: dict) -> tuple[dict, dict, str]:
    email = _s(data.get("email")).lower()
    password = data.get("password") or ""
    if not email or not password:
        raise ApiError(400, "missing_fields", "请输入邮箱和密码")

    with _conn() as conn:
        row = _user_row_by_email(conn, email)
        if not row or not auth.verify_password(password, row["password_hash"]):
            # 不区分「邮箱不存在」和「密码错误」，避免撞库探测
            log.warning("login failed email=%s", _mask_email(email))
            raise ApiError(401, "bad_credentials", "邮箱或密码不正确")
        token = _create_session(conn, row["id"])
        state = _load_state(conn, row)
    log.info("login user=%s email=%s", row["id"], _mask_email(email))
    return _public_user(row), state, token


def user_from_token(token: str | None) -> dict:
    """只取用户，不加载 AppState —— 媒体接口每次都要鉴权，别为它读整份 state。"""
    if not token:
        raise ApiError(401, "unauthorized", "请先登录")
    with _conn() as conn:
        row = _user_row_by_token(conn, token)
    if not row:
        raise ApiError(401, "unauthorized", "登录已过期，请重新登录")
    return _public_user(row)


def me(token: str | None) -> tuple[dict, dict]:
    if not token:
        raise ApiError(401, "unauthorized", "请先登录")
    with _conn() as conn:
        row = _user_row_by_token(conn, token)
        if not row:
            raise ApiError(401, "unauthorized", "登录已过期，请重新登录")
        state = _load_state(conn, row)
    return _public_user(row), state


def logout(token: str | None) -> None:
    if not token:
        return
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM sessions WHERE token_hash = %s", (auth.token_hash(token),))
    log.info("logout")


def save_state(token: str | None, state: dict) -> dict:
    if not token:
        raise ApiError(401, "unauthorized", "请先登录")
    baby = state.get("baby") or {}
    baby_name = _s(baby.get("name")) or ""
    birthday = _day_from_state(baby)
    baby["birthday"] = birthday.isoformat() if birthday else ""

    with _conn() as conn:
        row = _user_row_by_token(conn, token)
        if not row:
            raise ApiError(401, "unauthorized", "登录已过期，请重新登录")
        _save_state(conn, row["id"], state, baby_name, birthday)
    size = len(json.dumps(state, ensure_ascii=False, separators=(",", ":")))
    log.info(
        "state saved user=%s bytes=%d feeds=%d sleeps=%d photos=%d",
        row["id"],
        size,
        len(state.get("feeds") or []),
        len(state.get("sleeps") or []),
        len(state.get("photos") or []),
    )
    return {"ok": True, "savedAt": int(time.time() * 1000), "userId": row["id"]}


def reset_state(token: str | None) -> dict:
    if not token:
        raise ApiError(401, "unauthorized", "请先登录")
    with _conn() as conn:
        row = _user_row_by_token(conn, token)
        if not row:
            raise ApiError(401, "unauthorized", "登录已过期，请重新登录")
        birthday = row.get("baby_birthday")
        if row.get("email") == "demo@nestory.local":
            birthday = birthday or date.today()
            state = _seed_state(row.get("baby_name") or "宝宝", birthday)
        else:
            state = _empty_state(
                row.get("baby_name") or "",
                birthday.isoformat() if birthday else "",
            )
        _save_state(conn, row["id"], state, row.get("baby_name") or "", birthday)
    log.info("state reset user=%s", row["id"])
    return {"ok": True, "state": state}
