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
    # 媒体只在这里留一行元数据，字节在对象存储里；state 里存 /api/media/blob/<id>
    """
    CREATE TABLE IF NOT EXISTS media (
      id CHAR(32) NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      kind VARCHAR(8) NOT NULL,
      object_key VARCHAR(255) NOT NULL,
      mime VARCHAR(100) NOT NULL DEFAULT '',
      bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
      width INT UNSIGNED NULL,
      height INT UNSIGNED NULL,
      duration_sec DECIMAL(7,2) NULL,
      sha256 CHAR(64) NULL,
      state VARCHAR(10) NOT NULL DEFAULT 'ready',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME NULL,
      PRIMARY KEY (id),
      KEY idx_media_user (user_id, created_at),
      CONSTRAINT fk_media_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    # 一个家庭 = 一份共享 AppState。邀请加入的是家庭，不是某个人。
    """
    CREATE TABLE IF NOT EXISTS households (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(60) NOT NULL DEFAULT '宝宝的小屋',
      created_by BIGINT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_households_creator (created_by)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS household_members (
      household_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      permission ENUM('admin','edit','read') NOT NULL DEFAULT 'edit',
      joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (household_id, user_id),
      UNIQUE KEY uk_member_user (user_id),
      CONSTRAINT fk_hm_household FOREIGN KEY (household_id) REFERENCES households (id) ON DELETE CASCADE,
      CONSTRAINT fk_hm_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS invites (
      token CHAR(32) NOT NULL,
      household_id BIGINT UNSIGNED NOT NULL,
      created_by BIGINT UNSIGNED NOT NULL,
      permission ENUM('admin','edit','read') NOT NULL DEFAULT 'edit',
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      used_by BIGINT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (token),
      KEY idx_invites_household (household_id, created_at),
      CONSTRAINT fk_invites_household FOREIGN KEY (household_id) REFERENCES households (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS household_state (
      household_id BIGINT UNSIGNED NOT NULL,
      state_json MEDIUMTEXT NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (household_id),
      CONSTRAINT fk_hstate_household FOREIGN KEY (household_id) REFERENCES households (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
]

# 老库补列：CREATE TABLE IF NOT EXISTS 不会给已存在的表加字段，必须自己检查。
MIGRATIONS = [
    (
        "users",
        "avatar_media_id",
        "ALTER TABLE users ADD COLUMN avatar_media_id CHAR(32) NULL AFTER baby_birthday",
    ),
    (
        "media",
        "household_id",
        "ALTER TABLE media ADD COLUMN household_id BIGINT UNSIGNED NULL AFTER user_id",
    ),
    (
        "media",
        "idx_media_household",
        "ALTER TABLE media ADD KEY idx_media_household (household_id, created_at)",
    ),
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

    raw_port = str(cfg.get("port", "")).strip()
    try:
        cfg["port"] = int(raw_port)
    except (TypeError, ValueError):
        # 环境变量写错不该让整个后端起不来，退回默认端口
        cfg["port"] = int(DEFAULTS["port"])
    if not 0 < cfg["port"] < 65536:
        cfg["port"] = int(DEFAULTS["port"])
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
            _migrate_columns(cur)


def _migrate_columns(cur) -> None:
    """幂等补列/补索引：老库升级时不需要手工跑 SQL。"""
    for table, name, ddl in MIGRATIONS:
        cur.execute(
            """
            SELECT COUNT(*) AS n FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = %s
            """,
            (table, name),
        )
        if cur.fetchone()["n"]:
            continue
        if name.startswith("idx_"):
            cur.execute(
                """
                SELECT COUNT(*) AS n FROM information_schema.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND INDEX_NAME = %s
                """,
                (table, name),
            )
            if cur.fetchone()["n"]:
                continue
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
