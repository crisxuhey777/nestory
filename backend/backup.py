"""Nestory 数据备份：把 MySQL 里的业务表导成 gzip JSON，放进对象存储。

用法（容器里）：

    python backend/backup.py              # 备份一次，默认保留 14 份
    python backend/backup.py --keep 30    # 保留最近 30 份
    python backend/backup.py --dry-run    # 只打印会做什么，不写远程

为什么不是 mysqldump：运行镜像是 python:3.12-slim，没有 mysql 客户端；
这里的表结构很简单（users / sessions / user_state / media），用 PyMySQL
导出成 JSON 足够恢复，而且不依赖额外二进制。

恢复见 `python backend/backup.py --restore <key>`（会在事务里清表重写）。
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import decimal
import gzip
import json
import os
import sys
from pathlib import Path

import db
import storage

TABLES = ("users", "sessions", "user_state", "media")
BACKUP_DIR = "backups"
FORMAT_VERSION = 1


def _cell(value):
    if isinstance(value, dt.datetime):
        return {"$dt": value.isoformat(sep=" ")}
    if isinstance(value, dt.date):
        return {"$date": value.isoformat()}
    if isinstance(value, dt.timedelta):
        return {"$td": value.total_seconds()}
    if isinstance(value, decimal.Decimal):
        return {"$dec": str(value)}
    if isinstance(value, (bytes, bytearray)):
        return {"$b64": base64.b64encode(bytes(value)).decode("ascii")}
    return value


def _row(row: dict) -> dict:
    return {key: _cell(value) for key, value in row.items()}


def _prefix() -> str:
    cfg = storage.config()
    prefix = (cfg.get("prefix") or "").strip("/")
    return f"{prefix}/{BACKUP_DIR}" if prefix else BACKUP_DIR


def dump() -> dict:
    conn = db.connect()
    payload = {
        "format": FORMAT_VERSION,
        "createdAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "database": db.config().get("name"),
        "tables": {},
    }
    try:
        with conn.cursor() as cur:
            for table in TABLES:
                cur.execute(f"SELECT * FROM `{table}`")
                rows = [_row(row) for row in cur.fetchall()]
                payload["tables"][table] = rows
    finally:
        conn.close()
    return payload


def _env_int(name: str, default: int, minimum: int = 1) -> int:
    try:
        return max(minimum, int(os.environ.get(name) or default))
    except (TypeError, ValueError):
        return default


def backup(keep: int, dry_run: bool) -> dict:
    keep = max(1, int(keep))  # 0 会让 keys[0:] 把所有历史备份都删掉
    data = dump()
    counts = {name: len(rows) for name, rows in data["tables"].items()}
    raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    blob = gzip.compress(raw, compresslevel=6)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d-%H%M%S")
    key = f"{_prefix()}/{stamp}.json.gz"

    print(f"tables   : {counts}", flush=True)
    print(f"payload  : {len(raw) / 1024:.1f} KiB raw → {len(blob) / 1024:.1f} KiB gz", flush=True)
    print(f"key      : {key}", flush=True)
    print(f"driver   : {storage.driver()}", flush=True)

    if dry_run:
        print("dry-run  : 未写入对象存储", flush=True)
        return {"key": key, "counts": counts, "bytes": len(blob), "dryRun": True}

    storage.put(key, blob, "application/gzip")
    print("uploaded : ok", flush=True)

    keys = [k for k in storage.list_keys(f"{_prefix()}/") if k.endswith(".json.gz")]
    keys.sort(reverse=True)
    stale = keys[keep:]
    for old in stale:
        storage.delete(old)
        print(f"pruned   : {old}", flush=True)
    print(f"kept     : {min(len(keys), keep)} 份", flush=True)
    return {"key": key, "counts": counts, "bytes": len(blob), "kept": min(len(keys), keep)}


def _value(cell):
    if isinstance(cell, dict) and len(cell) == 1:
        if "$dt" in cell:
            return dt.datetime.fromisoformat(cell["$dt"])
        if "$date" in cell:
            return dt.date.fromisoformat(cell["$date"])
        if "$td" in cell:
            return dt.timedelta(seconds=cell["$td"])
        if "$dec" in cell:
            return decimal.Decimal(cell["$dec"])
        if "$b64" in cell:
            return base64.b64decode(cell["$b64"])
    return cell


def restore(key: str) -> int:
    request = storage.download(key)
    data = json.loads(gzip.decompress(request).decode("utf-8"))
    if data.get("format") != FORMAT_VERSION:
        raise SystemExit(f"备份格式不匹配: {data.get('format')}")

    conn = db.connect()
    order = list(TABLES)
    try:
        # db.connect() 默认 autocommit=True，直接清表会让每条语句立刻生效，
        # 中途失败就留下一个被清空且无法回滚的库。恢复必须显式关掉自动提交。
        conn.autocommit(False)
        with conn.cursor() as cur:
            cur.execute("SET FOREIGN_KEY_CHECKS = 0")
            for table in reversed(order):
                cur.execute(f"DELETE FROM `{table}`")
            for table in order:
                rows = data["tables"].get(table) or []
                if not rows:
                    continue
                columns = list(rows[0].keys())
                placeholders = ", ".join(["%s"] * len(columns))
                column_sql = ", ".join(f"`{c}`" for c in columns)
                sql = f"INSERT INTO `{table}` ({column_sql}) VALUES ({placeholders})"
                cur.executemany(sql, [[_value(row.get(c)) for c in columns] for row in rows])
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            with conn.cursor() as cur:
                cur.execute("SET FOREIGN_KEY_CHECKS = 1")
        except Exception:  # noqa: BLE001 - 连接已坏时不必再掩盖原始异常
            pass
        conn.close()
    counts = {name: len(rows) for name, rows in data["tables"].items()}
    print(f"restored : {counts}", flush=True)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Nestory 每日备份")
    parser.add_argument("--keep", type=int, default=_env_int("NESTORY_BACKUP_KEEP", 14))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--restore", metavar="KEY", help="从对象存储里的某个 key 恢复")
    args = parser.parse_args(argv)

    if args.keep < 1:
        raise SystemExit("--keep 至少为 1")
    if args.restore:
        return restore(args.restore)
    return backup(args.keep, args.dry_run)


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    raise SystemExit(main())
