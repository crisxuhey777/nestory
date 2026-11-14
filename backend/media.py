"""媒体登记与配额：``media`` 表 + 预签名流程。

前端流程：
    1. POST /api/media/presign   → {id, mode, uploadUrl, headers, url}
    2. 浏览器 PUT 文件到 uploadUrl（S3 直传）或 PUT /api/media/blob/<id>（代理）
    3. 之后 <img src="/api/media/blob/<id>"> 就能读到（后端 302 到签名地址）

state 里只存 ``/api/media/blob/<id>`` 这种短地址，媒体字节永远不进 AppState。
"""

from __future__ import annotations

import datetime as dt
import logging
import secrets

import accounts
import db
import family
import storage

log = logging.getLogger("nestory.media")

KINDS = {"photo", "video", "live"}
PHOTO_MAX = 12 * 1024 * 1024
TRASH_DAYS = 7
# 浏览器打开 SVG 会执行内嵌脚本，而媒体和站点同源，直接拒绝。
DENY_MIME = {"image/svg+xml", "image/svg"}


def _conn():
    return db.connect()


def _admin(conn, user: dict) -> dict:
    """删除与回收站只对家庭管理员开放。"""
    household, permission = family.permission_of(conn, user["id"])
    if permission != "admin":
        raise accounts.ApiError(403, "admin_only", "只有家庭管理员可以删除照片")
    return household


def _writer(conn, user: dict, purpose: str | None = None) -> dict:
    """上传等写操作要求 edit 及以上；只读成员只能看。

    例外是换自己的头像（purpose="avatar"）：后端 set_avatar 本就允许只读成员
    换头像，这里一刀切拒掉的话，只读成员的头像功能就废了。
    """
    household, permission = family.permission_of(conn, user["id"])
    if purpose == "avatar":
        return household
    if family.RANK.get(permission, 0) < family.RANK["edit"]:
        raise accounts.ApiError(403, "read_only", "只读成员不能上传或修改照片")
    return household


def kind_limit(kind: str) -> int:
    return PHOTO_MAX if kind == "photo" else storage.max_bytes()


def _household(conn, user: dict) -> dict:
    """媒体按家庭共享：同一家的成员都能看彼此上传的照片。"""
    row = family.household_for(conn, user["id"])
    if not row:
        raise accounts.ApiError(403, "no_household", "还没有加入任何家庭")
    return row


def usage(user_id: int) -> dict:
    with _conn() as conn:
        household = _household(conn, {"id": user_id})
        used = _used_bytes(conn, household["id"], user_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*) AS items
                FROM media
                WHERE (household_id = %s OR (household_id IS NULL AND user_id = %s))
                  AND deleted_at IS NULL
                """,
                (household["id"], user_id),
            )
            row = cur.fetchone() or {}
    return {
        "items": int(row.get("items") or 0),
        "bytes": used,
        "quotaBytes": storage.quota_bytes(),
    }


def _used_bytes(conn, household_id: int, user_id: int) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COALESCE(SUM(bytes), 0) AS bytes
            FROM media
            WHERE (household_id = %s OR (household_id IS NULL AND user_id = %s))
              AND deleted_at IS NULL
            """,
            (household_id, user_id),
        )
        row = cur.fetchone() or {}
    return int(row.get("bytes") or 0)


def _validate(payload: dict) -> tuple[str, str, int, str]:
    kind = str(payload.get("kind") or "photo").strip().lower()
    if kind not in KINDS:
        raise accounts.ApiError(400, "bad_kind", "kind 只能是 photo / video / live")
    mime = str(payload.get("mime") or "").strip().lower()
    if mime in DENY_MIME:
        raise accounts.ApiError(400, "bad_mime", "不支持 SVG，请改用 JPG / PNG / WebP")
    if mime not in ("",):
        allowed = {
            "photo": ("image/",),
            "live": ("image/", "video/"),
            "video": ("video/",),
        }[kind]
        if not mime.startswith(allowed):
            raise accounts.ApiError(400, "bad_mime", "文件类型和 kind 不匹配")
    try:
        size = int(payload.get("bytes") or 0)
    except (TypeError, ValueError):
        raise accounts.ApiError(400, "bad_bytes", "bytes 必须是数字")
    limit = kind_limit(kind)
    if size <= 0 or size > limit:
        raise accounts.ApiError(
            413,
            "too_large",
            f"单个文件不能超过 {round(limit / 1024 / 1024)} MB",
        )
    sha = str(payload.get("sha256") or "").strip().lower()
    if sha and (len(sha) != 64 or any(c not in "0123456789abcdef" for c in sha)):
        raise accounts.ApiError(400, "bad_sha", "sha256 格式不对")
    return kind, mime, size, sha


def _int(value, upper: int) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if 0 < number <= upper else None


def _float(value, upper: float) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if 0 < number <= upper else None


def _sweep_pending(user_id: int) -> None:
    """清掉一天前只登记、从未上传成功的 pending 行，避免永久占配额。

    行和对象要一起清：浏览器拿到预签名后可能已经把字节传上去了，
    只删行会留下永远没人引用、也没人清理的孤儿文件。
    """
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT object_key FROM media WHERE user_id = %s AND state = 'pending' "
                "AND created_at < NOW() - INTERVAL 1 DAY",
                (user_id,),
            )
            stale = [row["object_key"] for row in cur.fetchall()]
        if not stale:
            return
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM media WHERE user_id = %s AND state = 'pending' "
                "AND created_at < NOW() - INTERVAL 1 DAY",
                (user_id,),
            )
    for key in stale:
        try:
            storage.delete(key)
        except Exception as exc:  # noqa: BLE001 - 清孤儿失败不该挡住上传
            log.warning("sweep pending: delete object failed key=%s err=%s", key, exc)


def presign(user: dict, payload: dict) -> dict:
    """登记一条媒体并给出上传方式。"""
    if storage.driver() is None:
        raise accounts.ApiError(
            503, "storage_unavailable", "还没配置对象存储（NESTORY_S3_* 或 NESTORY_MEDIA_DIR）"
        )
    kind, mime, size, sha = _validate(payload)
    purpose = payload.get("purpose") if isinstance(payload.get("purpose"), str) else None
    if purpose == "avatar" and kind != "photo":
        raise accounts.ApiError(400, "bad_request", "头像只支持图片")
    _sweep_pending(user["id"])

    media_id = secrets.token_hex(16)
    key = storage.object_key(user["id"], media_id, mime)
    with _conn() as conn:
        household_id = _writer(conn, user, purpose)["id"]
        # 锁住家庭行再算配额：并发 presign 不能把 5GB 额度挤成 10GB。
        with db.transaction(conn):
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM households WHERE id = %s FOR UPDATE", (household_id,))
            used = _used_bytes(conn, household_id, user["id"])
            if used + size > storage.quota_bytes():
                raise accounts.ApiError(413, "quota_exceeded", "这个账号的媒体空间用完了")
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO media (id, user_id, household_id, kind, object_key, mime, bytes,
                                       width, height, duration_sec, sha256, state)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending')
                    """,
                    (
                        media_id,
                        user["id"],
                        household_id,
                        kind,
                        key,
                        mime,
                        size,
                        _int(payload.get("width"), 20000),
                        _int(payload.get("height"), 20000),
                        _float(payload.get("durationSec"), 86400),
                        sha or None,
                    ),
                )

    url = f"/api/media/blob/{media_id}"
    if storage.driver() == "s3" and not payload.get("proxy"):
        return {
            "id": media_id,
            "mode": "s3",
            "method": "PUT",
            "uploadUrl": storage.upload_url(key, mime),
            "headers": {"Content-Type": mime} if mime else {},
            "url": url,
            "expiresIn": 900,
        }
    return {"id": media_id, "mode": "proxy", "method": "PUT", "uploadUrl": url, "headers": {}, "url": url}


def confirm(user: dict, media_id: str, size: int = 0) -> dict:
    """标记上传完成。

    字节数以服务端从存储读到的真实大小为准（``size`` 只用于日志），
    否则客户端把 2GB 报成 1B 就能绕过家庭配额。
    """
    row = None
    with _conn() as conn:
        household, permission = family.permission_of(conn, user["id"])
        if not household:
            raise accounts.ApiError(403, "no_household", "还没有加入任何家庭")
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT * FROM media
                WHERE id = %s AND deleted_at IS NULL
                  AND (household_id = %s OR (household_id IS NULL AND user_id = %s))
                """,
                (media_id, household["id"], user["id"]),
            )
            row = cur.fetchone()
            if not row:
                raise accounts.ApiError(404, "not_found", "媒体不存在")
            # 只读成员只能确认自己上传的文件（换头像走这条），别人的一律拒。
            if (
                family.RANK.get(permission, 0) < family.RANK["edit"]
                and row["user_id"] != user["id"]
            ):
                raise accounts.ApiError(403, "read_only", "只读成员不能上传或修改照片")
            actual = storage.object_size(row["object_key"])
            if actual is None:
                raise accounts.ApiError(409, "upload_missing", "文件还没上传完成")
            limit = kind_limit(row["kind"])
            if actual <= 0 or actual > limit:
                cur.execute("DELETE FROM media WHERE id = %s", (media_id,))
                drop_object = row["object_key"]
            else:
                drop_object = ""
                cur.execute(
                    "UPDATE media SET state = 'ready', bytes = %s WHERE id = %s",
                    (actual, media_id),
                )
    if drop_object:
        try:
            storage.delete(drop_object)
        except Exception:  # noqa: BLE001 - 行已删掉，对象留着也只是垃圾
            log.warning("drop oversize object failed key=%s", drop_object)
        raise accounts.ApiError(
            413, "too_large", f"文件超过 {round(limit / 1024 / 1024)} MB"
        )
    log.info("media ready id=%s user=%s declared=%s actual=%s", media_id, user["id"], size, actual)
    return {"id": media_id, "url": f"/api/media/blob/{media_id}", "bytes": actual}


def row_for(user: dict, media_id: str, include_deleted: bool = False) -> dict:
    """include_deleted 只给回收站缩略图用：已删除的媒体只有管理员还能读。"""
    with _conn() as conn:
        household = _household(conn, user)
        sql = """
            SELECT * FROM media
            WHERE id = %s
              AND (household_id = %s OR (household_id IS NULL AND user_id = %s))
        """
        if not include_deleted:
            sql += " AND deleted_at IS NULL"
        with conn.cursor() as cur:
            cur.execute(sql, (media_id, household["id"], user["id"]))
            row = cur.fetchone()
        if row and row.get("deleted_at"):
            _perm = family.permission_of(conn, user["id"])[1]
            if _perm != "admin":
                raise accounts.ApiError(404, "not_found", "媒体不存在")
    if not row:
        raise accounts.ApiError(404, "not_found", "媒体不存在")
    return row


def listing(user: dict) -> dict:
    with _conn() as conn:
        household = _household(conn, user)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, kind, bytes, mime, width, height, duration_sec, created_at
                FROM media
                WHERE (household_id = %s OR (household_id IS NULL AND user_id = %s))
                  AND deleted_at IS NULL AND state = 'ready'
                ORDER BY created_at DESC
                LIMIT 500
                """,
                (household["id"], user["id"]),
            )
            rows = cur.fetchall() or []
    return {
        "items": [
            {
                "id": row["id"],
                "kind": row["kind"],
                "bytes": int(row["bytes"]),
                "mime": row["mime"],
                "width": row["width"],
                "height": row["height"],
                "durationSec": float(row["duration_sec"]) if row["duration_sec"] else None,
                "createdAt": int(row["created_at"].timestamp() * 1000)
                if hasattr(row.get("created_at"), "timestamp")
                else None,
                "url": f"/api/media/blob/{row['id']}",
            }
            for row in rows
        ],
        "usage": usage(user["id"]),
    }


def remove(user: dict, media_id: str) -> dict:
    """删除 = 移进回收站：保留 7 天，管理员可恢复，过期后清文件。"""
    with _conn() as conn:
        household = _admin(conn, user)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id FROM users
                WHERE avatar_media_id = %s
                  AND id IN (SELECT user_id FROM household_members WHERE household_id = %s)
                """,
                (media_id, household["id"]),
            )
            if cur.fetchone():
                raise accounts.ApiError(409, "avatar_in_use", "这张照片正在作为头像使用，先换掉头像再删除")
            cur.execute(
                """
                UPDATE media SET deleted_at = NOW()
                WHERE id = %s AND deleted_at IS NULL
                  AND (household_id = %s OR (household_id IS NULL AND user_id = %s))
                """,
                (media_id, household["id"], user["id"]),
            )
            if cur.rowcount == 0:
                raise accounts.ApiError(404, "not_found", "媒体不存在")
    log.info("media trashed id=%s user=%s", media_id, user["id"])
    return {"ok": True, "id": media_id, "days": TRASH_DAYS}


def trash(user: dict) -> dict:
    with _conn() as conn:
        household = _admin(conn, user)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT m.id, m.kind, m.bytes, m.mime, m.width, m.height,
                       m.created_at, m.deleted_at, u.nickname
                FROM media m
                JOIN users u ON u.id = m.user_id
                WHERE (m.household_id = %s OR (m.household_id IS NULL AND m.user_id = %s))
                  AND m.deleted_at IS NOT NULL
                  AND m.deleted_at > NOW() - INTERVAL %s DAY
                ORDER BY m.deleted_at DESC
                LIMIT 200
                """,
                (household["id"], user["id"], TRASH_DAYS),
            )
            rows = cur.fetchall() or []
    items = []
    for row in rows:
        deleted_at = row["deleted_at"]
        expires = deleted_at + dt.timedelta(days=TRASH_DAYS)
        items.append(
            {
                "id": row["id"],
                "kind": row["kind"],
                "bytes": int(row.get("bytes") or 0),
                "mime": row.get("mime") or "",
                "width": row.get("width"),
                "height": row.get("height"),
                "author": row.get("nickname") or "",
                "createdAt": _iso(row.get("created_at")),
                "deletedAt": _iso(deleted_at),
                "expiresAt": _iso(expires),
                "url": f"/api/media/blob/{row['id']}",
            }
        )
    return {"items": items, "days": TRASH_DAYS}


def restore(user: dict, media_id: str) -> dict:
    with _conn() as conn:
        household = _admin(conn, user)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, deleted_at FROM media
                WHERE id = %s
                  AND (household_id = %s OR (household_id IS NULL AND user_id = %s))
                """,
                (media_id, household["id"], user["id"]),
            )
            row = cur.fetchone()
            if not row:
                raise accounts.ApiError(404, "not_found", "媒体不存在")
            if not row.get("deleted_at"):
                return {"ok": True, "id": media_id, "restored": False}
            cur.execute(
                "SELECT deleted_at > NOW() - INTERVAL %s DAY AS alive FROM media WHERE id = %s",
                (TRASH_DAYS, media_id),
            )
            if not (cur.fetchone() or {}).get("alive"):
                raise accounts.ApiError(410, "trash_expired", "这张照片已经超过 7 天，无法恢复")
            cur.execute("UPDATE media SET deleted_at = NULL WHERE id = %s", (media_id,))
    log.info("media restored id=%s user=%s", media_id, user["id"])
    return {"ok": True, "id": media_id, "url": f"/api/media/blob/{media_id}"}


def purge_expired(days: int = TRASH_DAYS) -> int:
    """回收站过期清理：删对象存储里的文件与数据库行。"""
    with _conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, object_key FROM media
            WHERE deleted_at IS NOT NULL
              AND deleted_at <= NOW() - INTERVAL %s DAY
            LIMIT 500
            """,
            (days,),
        )
        rows = cur.fetchall() or []
    purged = 0
    if not rows:
        return 0
    # 一个连接删完这一批，不再每行新建一次连接。
    with _conn() as conn, conn.cursor() as cur:
        for row in rows:
            try:
                storage.delete(row["object_key"])
            except Exception:  # noqa: BLE001 - 文件已不在也要把行清掉
                log.warning("purge object failed id=%s key=%s", row["id"], row["object_key"])
            cur.execute("DELETE FROM media WHERE id = %s AND deleted_at IS NOT NULL", (row["id"],))
            purged += 1
    if purged:
        log.info("media purge removed %s expired items", purged)
    return purged


def _iso(value) -> str | None:
    """DB 里存的是本机时区的 naive datetime，输出成带 Z 的 UTC，前端才不会偏 8 小时。"""
    if not value:
        return None
    try:
        local = value if value.tzinfo else value.astimezone()
        return local.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except (AttributeError, OSError, ValueError):
        return str(value)


def bytes_for(user: dict, media_id: str) -> bytes:
    row = row_for(user, media_id, include_deleted=True)
    path = storage.local_path(row["object_key"])
    if storage.driver() != "local" or not path.is_file():
        raise accounts.ApiError(404, "not_found", "文件不在本地驱动上")
    return path.read_bytes()
