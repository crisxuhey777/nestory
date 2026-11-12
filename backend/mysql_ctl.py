#!/usr/bin/env python3
"""便携 MySQL 的启停助手。

    python backend/mysql_ctl.py status
    python backend/mysql_ctl.py start      # 未初始化会自动初始化
    python backend/mysql_ctl.py stop

默认使用项目自带的解包目录：
    %LOCALAPPDATA%\\Nestory\\mysql-8.4.9\\PFiles64\\MySQL\\MySQL Server 8.4
数据目录：
    %LOCALAPPDATA%\\Nestory\\mysql-data
可以用 NESTORY_MYSQL_HOME / NESTORY_MYSQL_DATA / NESTORY_DB_PORT 覆盖。
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
from pathlib import Path

LOCAL = Path(os.environ.get("LOCALAPPDATA") or Path.home())
BASE = Path(
    os.environ.get(
        "NESTORY_MYSQL_HOME",
        LOCAL / "Nestory" / "mysql-8.4.9" / "PFiles64" / "MySQL" / "MySQL Server 8.4",
    )
)
DATA = Path(os.environ.get("NESTORY_MYSQL_DATA", LOCAL / "Nestory" / "mysql-data"))
PORT = int(os.environ.get("NESTORY_DB_PORT", "3306"))
MYSQLD = BASE / "bin" / "mysqld.exe"
MYSQLADMIN = BASE / "bin" / "mysqladmin.exe"
LOG = DATA / "mysqld.log"

DETACHED_PROCESS = 0x00000008
CREATE_NEW_CONSOLE = 0x00000010
CREATE_NEW_PROCESS_GROUP = 0x00000200
SW_HIDE = 0


def _hidden_console() -> tuple[int, subprocess.STARTUPINFO]:
    """Give mysqld its own *hidden* console.

    MySQL on Windows starts the real server as a child process. If the parent has
    no console, that child allocates one, and Windows Terminal shows it as a new
    tab titled with the mysqld path. Giving the parent a hidden console means the
    child inherits it, so nothing is ever shown.
    """
    info = subprocess.STARTUPINFO()
    info.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    info.wShowWindow = SW_HIDE
    return CREATE_NEW_CONSOLE | CREATE_NEW_PROCESS_GROUP, info


def port_open(host: str = "127.0.0.1", port: int = PORT, timeout: float = 0.4) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(timeout)
        return sock.connect_ex((host, port)) == 0


def _tail_log(lines: int = 8) -> None:
    if not LOG.exists():
        return
    try:
        text = LOG.read_text(encoding="utf-8", errors="replace").splitlines()[-lines:]
    except OSError:
        return
    for line in text:
        print("  " + line)


def start() -> int:
    if port_open():
        print(f"MySQL already listening on 127.0.0.1:{PORT}")
        return 0
    if not MYSQLD.exists():
        print(f"mysqld not found: {MYSQLD}")
        print("run the installer once, or set NESTORY_MYSQL_HOME")
        return 1

    DATA.mkdir(parents=True, exist_ok=True)
    if not (DATA / "mysql").exists():
        print(f"initializing data directory: {DATA}")
        result = subprocess.run(
            [
                str(MYSQLD),
                "--initialize-insecure",
                f"--basedir={BASE}",
                f"--datadir={DATA}",
            ],
            cwd=str(BASE),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if result.returncode != 0:
            print("initialization FAILED")
            print((result.stderr or result.stdout or "")[-1500:])
            return 1

    print(f"starting mysqld on 127.0.0.1:{PORT} ...")
    flags, startupinfo = _hidden_console()
    subprocess.Popen(
        [
            str(MYSQLD),
            f"--basedir={BASE}",
            f"--datadir={DATA}",
            f"--port={PORT}",
            "--bind-address=127.0.0.1",
            f"--log-error={LOG}",
        ],
        cwd=str(BASE),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=flags,
        startupinfo=startupinfo,
    )

    deadline = time.time() + 30
    while time.time() < deadline:
        if port_open():
            print(f"MySQL ready on 127.0.0.1:{PORT}")
            return 0
        time.sleep(0.5)
    print("MySQL did not start within 30s; log tail:")
    _tail_log()
    return 1


def stop() -> int:
    if not port_open():
        print("MySQL is not running")
        return 0
    if not MYSQLADMIN.exists():
        print(f"mysqladmin not found: {MYSQLADMIN}")
        return 1
    result = subprocess.run(
        [
            str(MYSQLADMIN),
            "-h",
            "127.0.0.1",
            "-P",
            str(PORT),
            "-u",
            "root",
            "shutdown",
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    time.sleep(1.5)
    if result.returncode == 0 and not port_open():
        print("MySQL stopped")
        return 0
    print("stop failed:", (result.stderr or result.stdout or "").strip()[-300:])
    return 1


def status() -> int:
    print(f"base   : {BASE}")
    print(f"data   : {DATA}")
    print(f"port   : {PORT} ({'open' if port_open() else 'closed'})")
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    try:
        import db

        ok, detail = db.ping()
        print(f"ping   : {'ok' if ok else 'FAILED'} · {detail}")
        return 0 if ok else 1
    except Exception as exc:  # noqa: BLE001
        print(f"ping   : FAILED · {exc}")
        return 1


def main() -> int:
    action = sys.argv[1] if len(sys.argv) > 1 else "status"
    if action == "start":
        return start()
    if action == "stop":
        return stop()
    if action == "status":
        return status()
    if action == "ensure":
        return 0 if port_open() else start()
    print(f"unknown action: {action} (use start|stop|status|ensure)")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
