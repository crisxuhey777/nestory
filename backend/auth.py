"""密码哈希与会话令牌。

- 密码：PBKDF2-HMAC-SHA256，随机 16 字节盐，260000 次迭代
       存储格式 ``pbkdf2_sha256$260000$<salt_b64>$<hash_b64>``
- 会话：32 字节随机令牌，只把 SHA-256 摘要写进数据库
       浏览器拿 HttpOnly Cookie，脚本/数据库泄露都拿不到明文令牌
"""

from __future__ import annotations

import base64
import hashlib
import os
import secrets
from datetime import datetime, timedelta

ITERATIONS = 260_000
MAX_ITERATIONS = 2_000_000  # 防止被篡改的哈希把登录拖成 CPU DoS
SESSION_DAYS = 30
COOKIE_NAME = "nestory_session"


def _secure_flag() -> str:
    """HTTPS 部署时设 NESTORY_COOKIE_SECURE=1，让会话 Cookie 只走加密连接。

    默认关闭：本地 http://127.0.0.1 调试时带 Secure 的 Cookie 会被浏览器丢掉。
    """
    raw = os.environ.get("NESTORY_COOKIE_SECURE", "").strip().lower()
    return "; Secure" if raw in {"1", "true", "yes", "on"} else ""


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITERATIONS)
    return f"pbkdf2_sha256${ITERATIONS}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations, salt_b64, hash_b64 = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        rounds = int(iterations)
        if rounds < 1_000 or rounds > MAX_ITERATIONS:
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), _unb64(salt_b64), rounds
        )
        return secrets.compare_digest(digest, _unb64(hash_b64))
    except (ValueError, TypeError):
        return False


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def session_expiry(days: int = SESSION_DAYS) -> datetime:
    return datetime.now() + timedelta(days=days)


def cookie_header(token: str, days: int = SESSION_DAYS) -> str:
    return (
        f"{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax; "
        f"Max-Age={days * 86400}{_secure_flag()}"
    )


def clear_cookie() -> str:
    return f"{COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0{_secure_flag()}"


def parse_cookie(header: str | None) -> str | None:
    if not header:
        return None
    for part in header.split(";"):
        name, _, value = part.strip().partition("=")
        if name == COOKIE_NAME and value:
            return value
    return None
