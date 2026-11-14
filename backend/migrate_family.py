#!/usr/bin/env python3
"""把老账号迁移进家庭模型（幂等，可重复跑）。

    python backend/migrate_family.py --dry-run     # 只看看会发生什么
    python backend/migrate_family.py                # 先备份，再迁移

每一步：
    1. 备份（--no-backup 可跳过）
    2. 补列/建表（db.init_schema 是幂等的）
    3. 给还没有家庭的用户建 household + admin 成员
    4. 把 user_state 复制进 household_state（user_state 原样保留，可回滚）
    5. 回填 media.household_id

演示账号 state 里的 4 位「家庭成员」不会迁移：他们只是前端演示数据，
没有可登录的账号；迁移后 family 一律由 household_members 推导。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import backup  # noqa: E402
import db  # noqa: E402
import family  # noqa: E402


def migrate(dry_run: bool = False) -> dict:
    db.init_schema()
    stats = {"users": 0, "created": 0, "copied_state": 0, "media_linked": 0, "skipped": 0}
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, email, nickname, baby_name FROM users ORDER BY id")
            users = cur.fetchall() or []
        stats["users"] = len(users)
        for user in users:
            row = family.household_for(conn, user["id"])
            if row:
                stats["skipped"] += 1
                continue
            stats["created"] += 1
            print(f"  + user {user['id']} <{user['email']}> → 新建家庭（admin）")
            if dry_run:
                continue
            family.ensure(conn, user)
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT COUNT(*) AS n FROM household_members WHERE user_id = %s",
                    (user["id"],),
                )
                if int((cur.fetchone() or {}).get("n") or 0):
                    stats["copied_state"] += 1
        if not dry_run:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE media SET household_id = ("
                    "  SELECT household_id FROM household_members WHERE user_id = media.user_id LIMIT 1"
                    ") WHERE household_id IS NULL"
                )
                stats["media_linked"] = cur.rowcount
    return stats


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="Nestory 家庭模型迁移")
    parser.add_argument("--dry-run", action="store_true", help="只打印，不写库")
    parser.add_argument("--no-backup", action="store_true", help="跳过迁移前备份")
    args = parser.parse_args(argv)

    if not args.dry_run and not args.no_backup:
        info = backup.backup(keep=7, dry_run=False)
        print(f"backup: {info}")

    stats = migrate(dry_run=args.dry_run)
    print(
        "users={users} created={created} skipped={skipped} media_linked={media_linked}".format(**stats)
    )
    if args.dry_run:
        print("dry-run：没有写入任何数据")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
