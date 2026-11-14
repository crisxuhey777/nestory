"""媒体登记与配额：``media`` 表 + 预签名流程。

前端流程：
    1. POST /api/media/presign   → {id, mode, uploadUrl, headers, url}
    2. 浏览器 PUT 文件到 uploadUrl（S3 直传）或 PUT /api/media/blob/<id>（代理）
    3. 之后 <img src="/api/media/blob/<id>"> 就能读到（后端 302 到签名地址）

state 里只存 ``/api/media/blob/<id>`` 这种短地址，媒体字节永远不进 AppState。
"""

from __future__ import annotations

import logging
import secrets
import time

import accounts
import db
import family
import storage

log = logging.getLogger("nestory.media")

KINDS = {"photo", "video", "live"}
PHOTO_MAX = 12 * 1024 * 1024


def _conn():
    return db.connect()


def _household(conn, user: dict) -> dict:
    """媒体按家庭共享：同一家的成员都能看彼此上传的照片。"""
    row = family.household_for(conn, user["id"])
    if not row:
        raise accounts.ApiError(403, "no_household", "还没有加入任何家庭")
    return row


def usage(user_id: int) -> dict:
    with _conn() as conn:
        household = _household(conn, {"id": user_id})
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*) AS items, COALESCE(SUM(bytes), 0) AS bytes
                FROM media
                WHERE (household_id = %s OR (household_id IS NULL AND user_id = %s))
                  AND deleted_at IS NULL
                """,
                (household["id"], user_id),
            )
            row = cur.fetchone() or {}
    return {
        "items": int(row.get("items") or 0),
        "bytes": int(row.get("bytes") or 0),
        "quotaBytes": storage.quota_bytes(),
    }


def _validate(payload: dict) -> tuple[str, str, int, str]:
    kind = str(payload.get("kind") or "photo").strip().lower()
    if kind not in KINDS:
        raise accounts.ApiError(400, "bad_kind", "kind 只能是 photo / video / live")
    mime = str(payload.get("mime") or "").strip().lower()
    if mime not in ("",) and not (
        mime.startswith("image/") if kind == "photo" else mime.startswith("video/")
    ):
        raise accounts.ApiError(400, "bad_mime", "文件类型和 kind 不匹配")
    try:
        size = int(payload.get("bytes") or 0)
    except (TypeError, ValueError):
        raise accounts.ApiError(400, "bad_bytes", "bytes 必须是数字")
    limit = PHOTO_MAX if kind == "photo" else storage.max_bytes()
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
    """清掉一天前只登记、从未上传成功的 pending 行，避免永久占配额。"""
    with _conn() as conn, conn.cursor() as cur:
        cur.execute(
            "DELETE FROM media WHERE user_id = %s AND state = 'pending' "
            "AND created_at < NOW() - INTERVAL 1 DAY",
            (user_id,),
        )


def presign(user: dict, payload: dict) -> dict:
    """登记一条媒体并给出上传方式。"""
    if storage.driver() is None:
        raise accounts.ApiError(
            503, "storage_unavailable", "还没配置对象存储（NESTORY_S3_* 或 NESTORY_MEDIA_DIR）"
        )
    kind, mime, size, sha = _validate(payload)
    _sweep_pending(user["id"])
    used = usage(user["id"])["bytes"]
    if used + size > storage.quota_bytes():
        raise accounts.ApiError(413, "quota_exceeded", "这个账号的媒体空间用完了")

    media_id = secrets.token_hex(16)
    key = storage.object_key(user["id"], media_id, mime)
    with _conn() as conn:
        household_id = _household(conn, user)["id"]
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


def confirm(user: dict, media_id: str, size: int) -> dict:
    with _conn() as conn:
        household = _household(conn, user)
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
            cur.execute(
                "UPDATE media SET state = 'ready', bytes = %s WHERE id = %s",
                (size or row["bytes"], media_id),
            )
    log.info("media ready id=%s user=%s bytes=%s", media_id, user["id"], size)
    return {"id": media_id, "url": f"/api/media/blob/{media_id}"}


def row_for(user: dict, media_id: str) -> dict:
    with _conn() as conn:
        household = _household(conn, user)
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
    row = row_for(user, media_id)
    with _conn() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE media SET deleted_at = %s WHERE id = %s", (time.strftime("%Y-%m-%d %H:%M:%S"), media_id)
        )
    try:
        storage.delete(row["object_key"])
    except Exception:  # noqa: BLE001 - 对象已不在也无所谓
        log.warning("media object delete failed id=%s key=%s", media_id, row["object_key"])
    return {"ok": True}


def bytes_for(user: dict, media_id: str) -> bytes:
    row = row_for(user, media_id)
    path = storage.local_path(row["object_key"])
    if storage.driver() != "local" or not path.is_file():
        raise accounts.ApiError(404, "not_found", "文件不在本地驱动上")
    return path.read_bytes()
