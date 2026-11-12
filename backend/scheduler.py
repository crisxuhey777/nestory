"""进程内每日备份调度。

为什么不挂 CronJob：Sealos 的 6443（kubectl）在这台机器上时通时断，而应用本身
已经有对象存储和数据库凭据，交给同一个进程做备份既不用额外 Secret，也不用
imagePullSecrets 复制一份。代价是进程重启会重算下一次执行时间——这正好也是
想要的行为：漏掉的那天启动后会补一次。

相关环境变量：
    NESTORY_BACKUP_ENABLED   1/0，默认 1（没配对象存储时自动跳过）
    NESTORY_BACKUP_AT        每天执行时间，默认 "03:30"（固定按北京时间）
    NESTORY_BACKUP_KEEP      保留份数，默认 14
    NESTORY_BACKUP_TICK      检查间隔秒数，默认 300
"""

from __future__ import annotations

import datetime as dt
import os
import threading
import time

import backup as backup_job
import db
import storage

TZ = dt.timezone(dt.timedelta(hours=8))
TICK = 300

_state = {
    "enabled": False,
    "at": "03:30",
    "last": None,
    "kept": 0,
    "lastRunAt": None,
    "lastError": None,
}
_lock = threading.Lock()


def _bool_env(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _schedule() -> tuple[int, int]:
    raw = (os.environ.get("NESTORY_BACKUP_AT") or "03:30").strip()
    hour, _, minute = raw.partition(":")
    try:
        return int(hour), int(minute or 0)
    except ValueError:
        return 3, 30


def status() -> dict:
    with _lock:
        return dict(_state)


def _backup_prefix() -> str:
    prefix = (storage.config().get("prefix") or "").strip("/")
    return f"{prefix}/{backup_job.BACKUP_DIR}" if prefix else backup_job.BACKUP_DIR


def _latest() -> str | None:
    try:
        keys = [k for k in storage.list_keys(f"{_backup_prefix()}/") if k.endswith(".json.gz")]
    except Exception as exc:  # noqa: BLE001
        with _lock:
            _state["lastError"] = f"list failed: {exc}"
        return None
    keys.sort(reverse=True)
    with _lock:
        _state["kept"] = len(keys)
        _state["last"] = keys[0] if keys else None
        if _state["lastError"] and _state["lastError"].startswith("list failed"):
            _state["lastError"] = None
    return keys[0] if keys else None


def _run(keep: int) -> None:
    try:
        result = backup_job.backup(keep, dry_run=False)
    except Exception as exc:  # noqa: BLE001
        print(f"backup   : FAILED · {exc}", flush=True)
        with _lock:
            _state["lastError"] = str(exc)
        return
    with _lock:
        _state["last"] = result["key"]
        _state["lastRunAt"] = int(time.time() * 1000)
        _state["lastError"] = None
    print(f"backup   : ok · {result['key']} · kept {keep}", flush=True)
    _latest()


def _due() -> bool:
    hour, minute = _schedule()
    now = dt.datetime.now(TZ)
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if now < target:
        return False
    latest = _latest()
    with _lock:
        if _state["lastError"] and _state["lastError"].startswith("list failed"):
            # 列目录失败时别盲目重跑，否则每个 tick 都上传一份
            return False
    # 备份文件名用的是 UTC 日期（20261112-214059），别拿本地日期去比
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d")
    return latest is None or stamp not in latest


def _loop(keep: int, tick: int) -> None:
    # 等数据库就绪：容器里 MySQL 常常比应用晚 1-2 分钟
    deadline = time.monotonic() + 900
    while time.monotonic() < deadline:
        ok, _detail = db.ping()
        if ok:
            break
        time.sleep(10)
    _latest()
    while True:
        try:
            if _due():
                _run(keep)
        except Exception as exc:  # noqa: BLE001
            with _lock:
                _state["lastError"] = str(exc)
            print(f"backup   : scheduler error · {exc}", flush=True)
        time.sleep(tick)


def start() -> threading.Thread | None:
    if not _bool_env("NESTORY_BACKUP_ENABLED", True):
        print("backup   : disabled (NESTORY_BACKUP_ENABLED=0)", flush=True)
        return None
    if storage.driver() is None:
        print("backup   : skipped, no object storage configured", flush=True)
        return None
    keep = int(os.environ.get("NESTORY_BACKUP_KEEP", "14") or 14)
    tick = int(os.environ.get("NESTORY_BACKUP_TICK", str(TICK)) or TICK)
    hour, minute = _schedule()
    with _lock:
        _state.update(enabled=True, at=f"{hour:02d}:{minute:02d}")
    thread = threading.Thread(target=_loop, args=(keep, tick), name="backup", daemon=True)
    thread.start()
    print(f"backup   : daily at {hour:02d}:{minute:02d} (+08:00), keep {keep}", flush=True)
    return thread
