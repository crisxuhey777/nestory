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
from calendar import monthrange
from contextlib import contextmanager
from datetime import date, datetime, timedelta

import pymysql

import auth
import db
import family

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD = 8
MAX_PASSWORD = 200  # 上限既防超长输入，也防 PBKDF2 被当 CPU 放大器
log = logging.getLogger("nestory.auth")

_dummy_hash: str | None = None


def _dummy() -> str:
    """未知邮箱也做一次等价耗时的哈希校验，抹平账号枚举的时序差。"""
    global _dummy_hash
    if _dummy_hash is None:
        _dummy_hash = auth.hash_password("nestory-dummy-password")
    return _dummy_hash


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


def _record_time(kind: str, record: dict):
    key = "startedAt" if kind in ("feeds", "sleeps") else "at"
    return record.get(key)


ANNIVERSARY_MONTHS = {
    "满月纪念": 1,
    "三个月": 3,
    "半岁纪念": 6,
    "周岁纪念": 12,
    "两岁生日": 24,
    "三岁生日": 36,
}


def _add_months(day: date, months: int) -> date:
    total = day.year * 12 + (day.month - 1) + months
    year, month = divmod(total, 12)
    month += 1
    return date(year, month, min(day.day, monthrange(year, month)[1]))


def _anniversary_day(birth: date, label: str) -> date | None:
    if label == "百天纪念":
        return birth + timedelta(days=100)
    months = ANNIVERSARY_MONTHS.get(label)
    return _add_months(birth, months) if months else None


def _stale_anniversary(record: dict, birth) -> bool:
    """A recorded anniversary belongs to the birthday it was written under."""
    if birth is None or record.get("kind") != "anniversary":
        return False
    written = record.get("birthday")
    if isinstance(written, str) and written:
        return written != birth.isoformat()
    # 老记录没存生日：用标题反查当前生日的那一天，对不上就属于别的生日。
    at = record.get("at")
    if not isinstance(at, (int, float)):
        return False
    expected = _anniversary_day(birth, record.get("title") or "")
    if expected is None:
        return False
    try:
        return _ms_to_date(int(at)) != expected
    except (OverflowError, OSError, ValueError):
        return False


def _archive_prebirth(state: dict) -> bool:
    """Move records before the current birthday into state['archived'].

    This runs on load and save. Records are never deleted; changing the birthday
    back to an earlier date moves them back into the visible arrays. Anniversary
    milestones also follow the birthday they were recorded under, so changing the
    birthday hides them until it is changed back.
    """
    keys = ("feeds", "sleeps", "diapers", "growths", "milestones", "photos")
    archived = state.get("archived")
    if not isinstance(archived, dict):
        archived = {}
    birth = _day_from_state(state.get("baby") or {})
    changed = False
    for kind in keys:
        main = state.get(kind)
        old = archived.get(kind)
        main = [x for x in main if isinstance(x, dict)] if isinstance(main, list) else []
        old = [x for x in old if isinstance(x, dict)] if isinstance(old, list) else []
        merged = []
        seen = set()
        for item in [*old, *main]:
            item_id = item.get("id")
            if not item_id:
                # 没有 id 的记录无法去重，但也不能在加载时悄悄丢掉
                merged.append(item)
                continue
            if item_id in seen:
                continue
            seen.add(item_id)
            merged.append(item)
        keep = []
        hide = []
        for item in merged:
            if kind == "milestones" and _stale_anniversary(item, birth):
                hide.append(item)
                continue
            at = _record_time(kind, item)
            if birth is not None and isinstance(at, (int, float)):
                try:
                    before = _ms_to_date(int(at)) < birth
                except (OverflowError, OSError, ValueError):
                    before = False
                if before:
                    hide.append(item)
                    continue
            keep.append(item)
        if len(keep) != len(main) or len(hide) != len(old):
            changed = True
        state[kind] = keep
        archived[kind] = hide
    if archived:
        state["archived"] = archived
    visible_photo_ids = {p.get("id") for p in state.get("photos", []) if isinstance(p, dict)}
    hero = state.get("heroPhotoIds")
    if isinstance(hero, list):
        filtered = [pid for pid in hero if pid in visible_photo_ids]
        if filtered != hero:
            state["heroPhotoIds"] = filtered
            changed = True
    return changed


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
    avatar = row.get("avatar_media_id")
    return {
        "id": row["id"],
        "email": row["email"],
        "nickname": row["nickname"],
        "babyName": row["baby_name"],
        "babyBirthday": birthday.isoformat() if birthday else None,
        "avatarUrl": f"/api/media/blob/{avatar}" if avatar else None,
        "isDemo": row["email"] == "demo@nestory.local",
        "createdAt": row["created_at"].isoformat(timespec="seconds")
        if row.get("created_at")
        else None,
    }


def _create_session(conn, user_id: int) -> str:
    token = auth.new_token()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO sessions (token_hash, user_id, expires_at) "
            "VALUES (%s, %s, DATE_ADD(NOW(), INTERVAL %s DAY))",
            (auth.token_hash(token), user_id, auth.SESSION_DAYS),
        )
        # 顺手清理这个用户已经过期的会话
        cur.execute(
            "DELETE FROM sessions WHERE user_id = %s AND expires_at <= NOW()", (user_id,)
        )
        # 再全局扫一小批，避免从不登录的旧会话永久堆积
        cur.execute("DELETE FROM sessions WHERE expires_at <= NOW() LIMIT 500")
    return token


def _save_state(conn, user: dict, state: dict, baby_name: str, birthday: date | None) -> None:
    """写家庭共享状态，并把宝宝档案同步到个人账号上。

    ``state.family`` 由数据库推导，不落库；否则家庭成员一变动就会有两份不一致的副本。
    """
    family.strip(state)
    household = family.ensure(conn, user)
    family.save_state(conn, household["id"], state)
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE users SET baby_name = %s, baby_birthday = %s WHERE id = %s",
            (baby_name, birthday, user["id"]),
        )


def _normalize_demo_photos(state: dict) -> bool:
    """早期演示数据里 p1 同时作为静态 ph1 与 live ph5 存在，合并成唯一一条 live 记录。"""
    photos = [p for p in (state.get("photos") or []) if isinstance(p, dict)]
    by_id = {p.get("id"): p for p in photos}
    if "ph1" not in by_id or "ph5" not in by_id:
        return False

    live = by_id["ph5"]
    if live.get("kind") in (None, "live"):
        video = live.pop("video", None)
        duration = live.pop("durationSec", None)
        live["kind"] = "photo"
        if video:
            live["motion"] = {"video": video, "durationSec": duration or 3.5}

    kept = [p for p in photos if p.get("id") != "ph1"]
    valid = {p.get("id") for p in kept}
    hero: list[str] = []
    for pid in state.get("heroPhotoIds") or []:
        pid = "ph5" if pid == "ph1" else pid
        if pid in valid and pid not in hero:
            hero.append(pid)
    for photo in kept:
        if len(hero) >= 4:
            break
        pid = photo.get("id")
        if pid and pid not in hero:
            hero.append(pid)
    state["photos"] = kept
    state["heroPhotoIds"] = hero[:4]
    return True


def _load_state(conn, row: dict) -> dict:
    household = family.ensure(conn, row)
    saved = family.state_row(conn, household["id"])
    if saved:
        state = None
        try:
            loaded = json.loads(saved["state_json"])
        except json.JSONDecodeError as exc:
            log.warning("state json broken household=%s: %s", household["id"], exc)
            loaded = None
        if isinstance(loaded, dict) and loaded.get("version") == 3:
            state = loaded
            baby = state.get("baby") or {}
            raw = baby.get("birthday")
            if isinstance(raw, (int, float)):
                # 早期版本把生日存成了毫秒，读出来时顺手修正并落库
                try:
                    baby["birthday"] = _ms_to_date(int(raw)).isoformat()
                    _save_state(
                        conn,
                        row,
                        state,
                        (state.get("baby") or {}).get("name") or row.get("baby_name") or "",
                        _day_from_state(state.get("baby") or {}) or row.get("baby_birthday"),
                    )
                    log.info("migrated baby.birthday user=%s %s -> %s", row["id"], raw, baby["birthday"])
                except (ApiError, ValueError, OSError) as exc:
                    # 生日本身坏了不能把用户锁死在 400 上，重建一份可用状态
                    log.warning("cannot migrate birthday user=%s: %s", row["id"], exc)
                    state = None
        elif loaded is not None:
            log.warning(
                "state version mismatch household=%s: %r; rebuilding",
                household["id"],
                loaded.get("version") if isinstance(loaded, dict) else type(loaded).__name__,
            )
        if state is not None:
            normalized = _normalize_demo_photos(state)
            archived = _archive_prebirth(state)
            if normalized or archived:
                _save_state(
                    conn,
                    row,
                    state,
                    (state.get("baby") or {}).get("name") or row.get("baby_name") or "",
                    _day_from_state(state.get("baby") or {}) or row.get("baby_birthday"),
                )
                log.info("normalized demo photo / pre-birth records user=%s", row["id"])
            return family.attach(conn, row, state)

    # 老账号或数据损坏：建一份空状态，不再注入演示数据
    birthday = row.get("baby_birthday")
    state = _empty_state(
        row.get("baby_name") or "",
        birthday.isoformat() if birthday else "",
    )
    _save_state(conn, row, state, row.get("baby_name") or "", birthday)
    return family.attach(conn, row, state)


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
    if len(password) > MAX_PASSWORD:
        raise ApiError(400, "weak_password", f"password must be at most {MAX_PASSWORD} characters")
    if len(nickname) > 60:
        raise ApiError(400, "invalid_name", "nickname is too long")

    state = _empty_state()

    try:
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
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM users WHERE id = %s", (user_id,))
                row = cur.fetchone()
            # 建档同时建家庭：注册完就是自己家的 admin
            _save_state(conn, row, state, "", None)
            state = family.attach(conn, row, state)
            token = _create_session(conn, user_id)
    except pymysql.err.IntegrityError as exc:
        # 两个请求同时注册同一邮箱：唯一键会替我们裁决
        if exc.args and exc.args[0] == 1062:
            raise ApiError(409, "email_exists", "email already registered") from exc
        raise
    log.info("register user=%s email=%s", user_id, _mask_email(email))
    return _public_user(row), state, token



def login(data: dict) -> tuple[dict, dict, str]:
    email = _s(data.get("email")).lower()
    password = data.get("password") or ""
    if not email or not password:
        raise ApiError(400, "missing_fields", "请输入邮箱和密码")
    if len(password) > MAX_PASSWORD:
        raise ApiError(401, "bad_credentials", "邮箱或密码不正确")

    with _conn() as conn:
        row = _user_row_by_email(conn, email)
        # 未知邮箱也校验一次假哈希，避免用响应时间区分「账号不存在」和「密码错」
        stored = row["password_hash"] if row else _dummy()
        if not auth.verify_password(password, stored) or not row:
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

    with _conn() as conn:
        row = _user_row_by_token(conn, token)
        if not row:
            raise ApiError(401, "unauthorized", "登录已过期，请重新登录")
        household, permission = family.permission_of(conn, row["id"])
        if family.RANK.get(permission, 0) < family.RANK["edit"]:
            raise ApiError(403, "read_only", "这个账号是只读成员，不能修改记录")
        # 客户端漏字段时不要把已有档案清空：沿用库里保存的昵称和生日。
        if not baby_name and row.get("baby_name"):
            baby_name = row["baby_name"]
        if birthday is None and row.get("baby_birthday"):
            birthday = row["baby_birthday"]
        baby["name"] = baby_name
        baby["birthday"] = birthday.isoformat() if birthday else ""
        _archive_prebirth(state)
        _save_state(conn, row, state, baby_name, birthday)
        state = family.attach(conn, row, state)
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
            # Demo fixtures are keyed to the fixed birthday; restoring the
            # user-changed birthday would archive every fixture record.
            from app_state import build_state

            birthday = date.fromisoformat(build_state()["baby"]["birthday"])
            state = _seed_state(row.get("baby_name") or "宝宝", birthday)
        else:
            state = _empty_state(
                row.get("baby_name") or "",
                birthday.isoformat() if birthday else "",
            )
        _save_state(conn, row, state, row.get("baby_name") or "", birthday)
        state = family.attach(conn, row, state)
    log.info("state reset user=%s", row["id"])
    return {"ok": True, "state": state}
