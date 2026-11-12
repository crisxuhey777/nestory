"""MySQL 连接与建表。

配置来源（优先级从高到低）：
1. 环境变量 ``NESTORY_DB_HOST`` / ``NESTORY_DB_PORT`` / ``NESTORY_DB_USER`` /
   ``NESTORY_DB_PASSWORD`` / ``NESTORY_DB_NAME``
2. ``backend/db.env``（同目录，KEY=VALUE，一行一个，``#`` 开头是注释）
3. 内置默认值：127.0.0.1:3306，用户 nestory / 密码 nestory / 库 nestory

本文件只负责「连上去」和「建表」，业务逻辑在 accounts.py。
"""

from __future__ import annotations

import os
import time
from pathlib import Path

import pymysql
from pymysql.cursors import DictCursor

BASE_DIR = Path(__file__).resolve().parent
ENV_FILE = BASE_DIR / "db.env"

DEFAULTS = {
    "host": "127.0.0.1",
    "port": 3306,
    "user": "nestory",
    "password": "nestory",
    "database": "nestory",
}

ENV_KEYS = {
    "host": "NESTORY_DB_HOST",
    "port": "NESTORY_DB_PORT",
    "user": "NESTORY_DB_USER",
    "password": "NESTORY_DB_PASSWORD",
    "database": "NESTORY_DB_NAME",
}

SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      email VARCHAR(190) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      nickname VARCHAR(60) NOT NULL DEFAULT '',
      baby_name VARCHAR(60) NOT NULL DEFAULT '',
      baby_birthday DATE NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_users_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash CHAR(64) NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      PRIMARY KEY (token_hash),
      KEY idx_sessions_user (user_id),
      CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS user_state (
      user_id BIGINT UNSIGNED NOT NULL,
      state_json MEDIUMTEXT NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id),
      CONSTRAINT fk_state_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
]


def _read_env_file(path: Path = ENV_FILE) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            values[key] = value
    return values


def config() -> dict:
    file_values = _read_env_file()
    cfg = dict(DEFAULTS)
    for field, env_key in ENV_KEYS.items():
        if env_key in file_values and env_key not in os.environ:
            cfg[field] = file_values[env_key]
        if env_key in os.environ:
            cfg[field] = os.environ[env_key]
    cfg["port"] = int(cfg["port"])
    return cfg


def connect() -> pymysql.connections.Connection:
    cfg = config()
    return pymysql.connect(
        host=cfg["host"],
        port=cfg["port"],
        user=cfg["user"],
        password=cfg["password"],
        database=cfg["database"],
        charset="utf8mb4",
        cursorclass=DictCursor,
        autocommit=True,
        connect_timeout=3,
        read_timeout=10,
        write_timeout=10,
    )


def init_schema() -> None:
    with connect() as conn:
        with conn.cursor() as cur:
            for ddl in SCHEMA:
                cur.execute(ddl)


def ping() -> tuple[bool, str]:
    """给启动日志与 /api/health 用：返回 (ok, 说明)。"""
    cfg = config()
    label = f"{cfg['user']}@{cfg['host']}:{cfg['port']}/{cfg['database']}"
    started = time.perf_counter()
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 AS ok")
                cur.fetchone()
        return True, f"{label} · {int((time.perf_counter() - started) * 1000)} ms"
    except Exception as exc:  # noqa: BLE001 - 启动日志要展示原始原因
        return False, f"{label} · {exc.__class__.__name__}: {exc}"
