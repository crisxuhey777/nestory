#!/usr/bin/env python3
"""一次性初始化 MySQL：建库、建应用账号、建表。

默认连接 root（空密码），适合本项目自带的便携 MySQL；如果你用的是自己装的
MySQL，请把 root 密码传进来：

    python backend/setup_mysql.py --root-password 你的root密码

重复执行是安全的（CREATE ... IF NOT EXISTS / ALTER USER）。
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

import pymysql

sys.path.insert(0, str(Path(__file__).resolve().parent))

import db  # noqa: E402

IDENT = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]*$")


def main() -> int:
    cfg = db.config()
    parser = argparse.ArgumentParser(description="Create the Nestory MySQL database and tables")
    parser.add_argument("--host", default=cfg["host"])
    parser.add_argument("--port", type=int, default=cfg["port"])
    parser.add_argument("--root-user", default="root")
    parser.add_argument("--root-password", default="")
    args = parser.parse_args()

    app_user, app_password, database = cfg["user"], cfg["password"], cfg["database"]
    for value in (app_user, database):
        if not IDENT.match(value):
            print(f"invalid identifier: {value!r}")
            return 1

    try:
        conn = pymysql.connect(
            host=args.host,
            port=args.port,
            user=args.root_user,
            password=args.root_password,
            autocommit=True,
            connect_timeout=5,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"cannot connect as {args.root_user}@{args.host}:{args.port} -> {exc}")
        return 1

    with conn.cursor() as cur:
        cur.execute(
            f"CREATE DATABASE IF NOT EXISTS `{database}` "
            "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
        )
        for host in ("127.0.0.1", "localhost"):
            cur.execute(
                f"CREATE USER IF NOT EXISTS '{app_user}'@'{host}' IDENTIFIED BY %s",
                (app_password,),
            )
            cur.execute(
                f"ALTER USER '{app_user}'@'{host}' IDENTIFIED BY %s", (app_password,)
            )
            cur.execute(f"GRANT ALL PRIVILEGES ON `{database}`.* TO '{app_user}'@'{host}'")
        cur.execute("FLUSH PRIVILEGES")
    conn.close()

    # init_schema() 通过 db.config() 连接；把本次 --host/--port 固定进环境，
    # 否则用了非默认地址时会连回默认地址去建表。
    os.environ["NESTORY_DB_HOST"] = args.host
    os.environ["NESTORY_DB_PORT"] = str(args.port)
    db.init_schema()
    ok, detail = db.ping()
    print(f"database : {database} ready")
    print(f"account  : {app_user}@{args.host}:{args.port}")
    print(f"schema   : users / sessions / user_state")
    print(f"ping     : {'ok' if ok else 'FAILED'} · {detail}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
