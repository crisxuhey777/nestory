"""家庭（household）：成员、权限、邀请，以及按家庭读写的那份 AppState。

一个家庭共享一份 ``household_state``，成员各有权限：

    admin   邀请家人、改权限、移出成员，读写记录
    edit    读写记录
    read    只能看

老账号第一次访问时自动补建家庭（把 ``user_state`` 搬进 ``household_state``），
所以升级不需要停服；想一次性批量迁移可以跑 ``backend/migrate_family.py``。

对外错误码沿用 ``accounts.ApiError``，这里延迟导入，避免两个模块循环 import。
"""

from __future__ import annotations

import json
import logging
import secrets
from contextlib import contextmanager
from datetime import datetime, timedelta

import db

log = logging.getLogger("nestory.family")

PERMISSIONS = ("admin", "edit", "read")
INVITE_DAYS = 7
RANK = {"read": 1, "edit": 2, "admin": 3}
AVATAR_COLORS = ["#304B3B", "#8C6A4A", "#6E7F63", "#B08968", "#5C6B73", "#9C6B62"]


def _err(status: int, code: str, message: str):
    from accounts import ApiError

    return ApiError(status, code, message)


def _s(value, fallback: str = "") -> str:
    return value.strip() if isinstance(value, str) else fallback


@contextmanager
def connect():
    """给路由层用的连接；连接失败统一转成 503。"""
    try:
        conn = db.connect()
    except Exception as exc:  # noqa: BLE001
        log.warning("db connect failed: %s: %s", type(exc).__name__, exc)
        raise _err(503, "db_unavailable", "MySQL 没有连上，请先启动数据库（3306）") from exc
    try:
        yield conn
    finally:
        conn.close()


def _iso(value) -> str | None:
    return value.isoformat(timespec="seconds") if isinstance(value, datetime) else None


def household_for(conn, user_id: int) -> dict | None:
    """当前账号所在家庭；一个账号 v1 只属于一个家庭。"""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT h.id, h.name, h.created_by, h.created_at, m.permission, m.joined_at
            FROM household_members m
            JOIN households h ON h.id = m.household_id
            WHERE m.user_id = %s
            LIMIT 1
            """,
            (user_id,),
        )
        return cur.fetchone()


def ensure(conn, user: dict) -> dict:
    """老账号首次访问时补建家庭：建 households 行、admin 成员，并搬 state。"""
    row = household_for(conn, user["id"])
    if row:
        _backfill(conn, row["id"], user["id"])
        return row

    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO households (name, created_by) VALUES (%s, %s)",
            (f"{_s(user.get('nickname')) or '我'}的家", user["id"]),
        )
        household_id = cur.lastrowid
        cur.execute(
            "INSERT INTO household_members (household_id, user_id, permission) VALUES (%s, %s, 'admin')",
            (household_id, user["id"]),
        )
        # 老数据只有 user_state：复制一份进 household_state，user_state 原样保留可回滚。
        cur.execute(
            "SELECT state_json FROM user_state WHERE user_id = %s", (user["id"],)
        )
        legacy = cur.fetchone()
        if legacy and legacy.get("state_json"):
            cur.execute(
                """
                INSERT INTO household_state (household_id, state_json) VALUES (%s, %s)
                ON DUPLICATE KEY UPDATE state_json = VALUES(state_json)
                """,
                (household_id, legacy["state_json"]),
            )
    _backfill(conn, household_id, user["id"])
    log.info("household created user=%s household=%s", user["id"], household_id)
    return household_for(conn, user["id"])  # type: ignore[return-value]


def _backfill(conn, household_id: int, user_id: int) -> None:
    """把还没有归属的媒体挂到家庭上（只跑一次，幂等）。"""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE media SET household_id = %s WHERE user_id = %s AND household_id IS NULL",
            (household_id, user_id),
        )


def state_row(conn, household_id: int) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT state_json FROM household_state WHERE household_id = %s",
            (household_id,),
        )
        return cur.fetchone()


def save_state(conn, household_id: int, state: dict) -> None:
    payload = json.dumps(state, ensure_ascii=False, separators=(",", ":"))
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO household_state (household_id, state_json) VALUES (%s, %s)
            ON DUPLICATE KEY UPDATE state_json = VALUES(state_json)
            """,
            (household_id, payload),
        )


def members(conn, household_id: int) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT m.user_id, m.permission, m.joined_at,
                   u.nickname, u.avatar_media_id
            FROM household_members m
            JOIN users u ON u.id = m.user_id
            WHERE m.household_id = %s
            ORDER BY m.joined_at, m.user_id
            """,
            (household_id,),
        )
        return cur.fetchall() or []


def family_members(conn, household_id: int, viewer_id: int) -> list[dict]:
    """前端 ``state.family`` 的形状，id 用字符串（和记录 id 保持同类）。"""
    out = []
    for index, row in enumerate(members(conn, household_id)):
        uid = int(row["user_id"])
        avatar = row.get("avatar_media_id")
        out.append(
            {
                "id": str(uid),
                "name": _s(row.get("nickname")) or f"家人 {uid}",
                "role": "我" if uid == viewer_id else "",
                "color": AVATAR_COLORS[index % len(AVATAR_COLORS)],
                "permission": row["permission"],
                "avatarUrl": f"/api/media/blob/{avatar}" if avatar else None,
                "joinedAt": _iso(row.get("joined_at")),
            }
        )
    return out


def attach(conn, user: dict, state: dict) -> dict:
    """把家庭信息挂进 state；同时清掉客户端可能带回来的旧副本。"""
    household = ensure(conn, user)
    state["family"] = family_members(conn, household["id"], user["id"])
    state["viewerId"] = str(user["id"])
    return state


def strip(state: dict) -> None:
    """family 由服务端推导，不落库，避免两份数据打架。"""
    state.pop("family", None)
    state.pop("viewerId", None)


def permission_of(conn, user_id: int) -> tuple[dict, str]:
    household = household_for(conn, user_id)
    if not household:
        raise _err(403, "no_household", "还没有加入任何家庭")
    return household, household["permission"]


def _require(conn, user_id: int, minimum: str) -> dict:
    household, permission = permission_of(conn, user_id)
    if RANK.get(permission, 0) < RANK[minimum]:
        raise _err(403, "forbidden", "没有权限执行这个操作")
    return household


def payload(conn, user: dict) -> dict:
    household = ensure(conn, user)
    return {
        "household": {
            "id": household["id"],
            "name": household["name"],
            "createdAt": _iso(household.get("created_at")),
        },
        "me": {
            "userId": str(user["id"]),
            "permission": household["permission"],
            "isAdmin": household["permission"] == "admin",
        },
        "members": family_members(conn, household["id"], user["id"]),
    }


def preview(conn, token: str) -> dict:
    """Join 页在登录前先看邀请是否还能用，避免白注册一个账号。"""
    token = _s(token)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT i.token, i.permission, i.expires_at, i.used_at,
                   h.id AS household_id, h.name AS household_name,
                   u.nickname AS inviter
            FROM invites i
            JOIN households h ON h.id = i.household_id
            LEFT JOIN users u ON u.id = i.created_by
            WHERE i.token = %s
            """,
            (token,),
        )
        row = cur.fetchone()
    if not row:
        raise _err(404, "invalid_invite", "这个邀请链接不存在")
    status = "ok"
    if row.get("used_at"):
        status = "used"
    elif row["expires_at"] <= datetime.now():
        status = "expired"
    return {
        "status": status,
        "household": {"id": row["household_id"], "name": row["household_name"]},
        "permission": row["permission"],
        "inviter": _s(row.get("inviter")) or "家人",
        "expiresAt": _iso(row["expires_at"]),
    }


def create_invite(conn, user: dict, permission: str) -> dict:
    permission = permission if permission in PERMISSIONS else "edit"
    household = _require(conn, user["id"], "admin")
    token = secrets.token_hex(16)
    expires = datetime.now() + timedelta(days=INVITE_DAYS)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO invites (token, household_id, created_by, permission, expires_at)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (token, household["id"], user["id"], permission, expires),
        )
    log.info("invite created household=%s by=%s permission=%s", household["id"], user["id"], permission)
    return {
        "token": token,
        "permission": permission,
        "expiresAt": _iso(expires),
        "days": INVITE_DAYS,
    }


def _is_solo(conn, household_id: int, user_id: int) -> bool:
    """只有自己、且自己是 admin 的家庭 —— 说明是注册时自动建的空壳。"""
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM household_members WHERE household_id = %s", (household_id,))
        if int((cur.fetchone() or {}).get("n") or 0) != 1:
            return False
        cur.execute(
            "SELECT permission FROM household_members WHERE household_id = %s AND user_id = %s",
            (household_id, user_id),
        )
        row = cur.fetchone()
        return bool(row) and row["permission"] == "admin"


def _dissolve(conn, household_id: int, user_id: int, target_household_id: int) -> None:
    """把空壳家庭删掉，历史媒体挪进新家庭，避免加入后照片找不回来。"""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE media SET household_id = %s WHERE household_id = %s",
            (target_household_id, household_id),
        )
        cur.execute("DELETE FROM household_state WHERE household_id = %s", (household_id,))
        cur.execute("DELETE FROM household_members WHERE household_id = %s AND user_id = %s", (household_id, user_id))
        cur.execute("DELETE FROM households WHERE id = %s", (household_id,))
    log.info("solo household dissolved household=%s user=%s -> %s", household_id, user_id, target_household_id)


def join(conn, user: dict, token: str) -> dict:
    token = _s(token)
    if not token:
        raise _err(400, "missing_token", "邀请链接不完整")
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM invites WHERE token = %s", (token,))
        invite = cur.fetchone()
    if not invite:
        raise _err(404, "invalid_invite", "这个邀请链接不存在")
    if invite.get("used_at"):
        raise _err(410, "invite_used", "这个邀请链接已经被使用过了")
    if invite["expires_at"] <= datetime.now():
        raise _err(410, "invite_expired", "这个邀请链接已经过期，请让家人重新发一个")

    existing = household_for(conn, user["id"])
    if existing:
        if existing["id"] == invite["household_id"]:
            return payload(conn, user)
        # 注册时每个人都自动有一个「只有自己」的家庭；加入别人时把它解散。
        if not _is_solo(conn, existing["id"], user["id"]):
            raise _err(409, "already_in_family", "这个账号已经在一个家庭里了")
        _dissolve(conn, existing["id"], user["id"], invite["household_id"])

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO household_members (household_id, user_id, permission)
            VALUES (%s, %s, %s)
            """,
            (invite["household_id"], user["id"], invite["permission"]),
        )
        cur.execute(
            "UPDATE invites SET used_at = NOW(), used_by = %s WHERE token = %s AND used_at IS NULL",
            (user["id"], token),
        )
        if cur.rowcount == 0:
            # 并发下别人先用了这条邀请
            raise _err(410, "invite_used", "这个邀请链接已经被使用过了")
    _backfill(conn, invite["household_id"], user["id"])
    log.info("invite joined household=%s user=%s", invite["household_id"], user["id"])
    return payload(conn, user)


def update_member(conn, actor_id: int, target_id: int, permission: str) -> dict:
    if permission not in PERMISSIONS:
        raise _err(400, "bad_permission", "权限只能是 admin / edit / read")
    household = _require(conn, actor_id, "admin")
    if not _is_member(conn, household["id"], target_id):
        raise _err(404, "not_member", "这位家人不在当前家庭里")
    current = _member_permission(conn, household["id"], target_id)
    if current == "admin" and permission != "admin" and _admin_count(conn, household["id"]) <= 1:
        raise _err(400, "last_admin", "至少要保留一位家庭管理员")
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE household_members SET permission = %s WHERE household_id = %s AND user_id = %s",
            (permission, household["id"], target_id),
        )
    log.info("member permission household=%s target=%s %s->%s", household["id"], target_id, current, permission)
    return {"ok": True, "userId": str(target_id), "permission": permission}


def remove_member(conn, actor_id: int, target_id: int) -> dict:
    household = _require(conn, actor_id, "admin")
    if target_id == actor_id:
        raise _err(400, "self_remove", "不能把自己移出家庭")
    if not _is_member(conn, household["id"], target_id):
        raise _err(404, "not_member", "这位家人不在当前家庭里")
    if _member_permission(conn, household["id"], target_id) == "admin" and _admin_count(conn, household["id"]) <= 1:
        raise _err(400, "last_admin", "至少要保留一位家庭管理员")
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM household_members WHERE household_id = %s AND user_id = %s",
            (household["id"], target_id),
        )
    log.info("member removed household=%s target=%s by=%s", household["id"], target_id, actor_id)
    return {"ok": True, "userId": str(target_id)}


def set_avatar(conn, user: dict, media_id: str) -> dict:
    # 头像属于账号本身：只读成员也应该能换自己的头像，只要求是这个家的成员。
    household, _permission = permission_of(conn, user["id"])
    media_id = _s(media_id)
    if not media_id:
        raise _err(400, "missing_media", "缺少头像文件")
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id FROM media
            WHERE id = %s AND deleted_at IS NULL AND state = 'ready'
              AND (household_id = %s OR user_id = %s)
            """,
            (media_id, household["id"], user["id"]),
        )
        if not cur.fetchone():
            raise _err(404, "not_found", "头像文件还没上传完成")
        cur.execute("UPDATE users SET avatar_media_id = %s WHERE id = %s", (media_id, user["id"]))
    return {"ok": True, "avatarUrl": f"/api/media/blob/{media_id}"}


def _is_member(conn, household_id: int, user_id: int) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM household_members WHERE household_id = %s AND user_id = %s",
            (household_id, user_id),
        )
        return cur.fetchone() is not None


def _member_permission(conn, household_id: int, user_id: int) -> str:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT permission FROM household_members WHERE household_id = %s AND user_id = %s",
            (household_id, user_id),
        )
        row = cur.fetchone()
    return (row or {}).get("permission") or "read"


def _admin_count(conn, household_id: int) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) AS n FROM household_members WHERE household_id = %s AND permission = 'admin'",
            (household_id,),
        )
        return int((cur.fetchone() or {}).get("n") or 0)
