"""Nestory 后端日志：控制台实时输出 + 后台线程定时落盘。

为什么不用 logging 的默认行为：
- 控制台要在 Windows 的 cp1252 窗口里也能打中文，所以统一走已 reconfigure 的 stdout；
- 文件要能「定时写盘」：后台每 2 秒 flush + fsync 一次，进程被杀也不会丢掉最后一段；
- 按天切分（保留 14 天），排查问题时可以直接翻某一天的日志。

日志里不记录密码、会话令牌、Cookie 和整份 AppState，只记用户 id、体积、耗时与错误。
"""

from __future__ import annotations

import atexit
import logging
import logging.handlers
import os
import sys
import threading
import time
from pathlib import Path

LOG_DIR = Path(__file__).resolve().parent / "logs"
DEFAULT_LEVEL = "INFO"
FLUSH_INTERVAL = 2.0
KEEP_DAYS = 14

_logger = logging.getLogger("nestory")
_handlers: list[logging.Handler] = []
_flusher: "_PeriodicFlush | None" = None
_log_file: Path | None = None


class _PeriodicFlush(threading.Thread):
    """每 2 秒把文件 handler 刷到底，避免缓冲区里丢最后几条。"""

    def __init__(self, handlers: list[logging.Handler], interval: float = FLUSH_INTERVAL):
        super().__init__(name="nestory-log-flush", daemon=True)
        self.handlers = list(handlers)
        self.interval = interval
        self._stop = threading.Event()

    def run(self) -> None:
        while not self._stop.wait(self.interval):
            flush(self.handlers)

    def stop(self) -> None:
        self._stop.set()


def flush(handlers: list[logging.Handler] | None = None) -> None:
    for handler in handlers if handlers is not None else _handlers:
        stream = getattr(handler, "stream", None)
        if stream is None:
            continue
        try:
            handler.acquire()
            try:
                handler.flush()
                if hasattr(stream, "fileno"):
                    os.fsync(stream.fileno())
            finally:
                handler.release()
        except (OSError, ValueError):
            # 日志不能反过来影响服务；磁盘满/句柄失效时静默跳过
            pass


def setup(
    level: str = DEFAULT_LEVEL,
    log_dir: str | os.PathLike[str] | None = None,
    *,
    console: bool = True,
    file: bool = True,
) -> logging.Logger:
    """配置 ``nestory`` logger；重复调用会先清掉上一次的 handler（测试用）。"""
    global _flusher, _log_file

    for handler in list(_handlers):
        _logger.removeHandler(handler)
        try:
            handler.close()
        except Exception:  # noqa: BLE001
            pass
    _handlers.clear()
    if _flusher is not None:
        _flusher.stop()
        _flusher = None

    _logger.setLevel(getattr(logging, str(level).upper(), logging.INFO))
    _logger.propagate = False

    if console:
        ch = logging.StreamHandler(sys.stdout)
        ch.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)-5s %(message)s", datefmt="%H:%M:%S")
        )
        _logger.addHandler(ch)
        _handlers.append(ch)

    _log_file = None
    if file:
        target = Path(log_dir) if log_dir else LOG_DIR
        try:
            target.mkdir(parents=True, exist_ok=True)
            fh = logging.handlers.TimedRotatingFileHandler(
                target / "nestory.log",
                when="midnight",
                backupCount=KEEP_DAYS,
                encoding="utf-8-sig",
                delay=False,
            )
            fh.setFormatter(
                logging.Formatter(
                    "%(asctime)s.%(msecs)03d %(levelname)-5s %(threadName)-18s %(name)s %(message)s",
                    datefmt="%Y-%m-%d %H:%M:%S",
                )
            )
            _logger.addHandler(fh)
            _handlers.append(fh)
            _log_file = target / "nestory.log"
        except OSError as exc:
            _logger.warning("日志文件不可用，只输出到控制台：%s", exc)

    _flusher = _PeriodicFlush([h for h in _handlers if hasattr(h, "stream")])
    _flusher.start()
    atexit.register(close)
    return _logger


def log_file() -> Path | None:
    return _log_file


def close() -> None:
    global _flusher
    if _flusher is not None:
        _flusher.stop()
        _flusher.join(timeout=1.5)
        _flusher = None
    flush()
    for handler in list(_handlers):
        try:
            handler.close()
        except Exception:  # noqa: BLE001
            pass
    _handlers.clear()


def install_exception_hooks(logger: logging.Logger | None = None) -> None:
    """未捕获异常也写进日志，而不是只留在控制台的 traceback 里。"""
    log = logger or _logger

    def hook(exc_type, exc, tb):
        if issubclass(exc_type, KeyboardInterrupt):
            sys.__excepthook__(exc_type, exc, tb)
            return
        log.error("unhandled exception", exc_info=(exc_type, exc, tb))

    sys.excepthook = hook

    def thread_hook(args):
        name = args.thread.name if args.thread else "?"
        log.error(
            "unhandled exception in thread %s",
            name,
            exc_info=(args.exc_type, args.exc_value, args.exc_traceback),
        )

    threading.excepthook = thread_hook


def startup_line(**fields) -> None:
    """把启动信息压成一行写进日志，方便和请求日志对上时间。"""
    parts = [f"{key}={value}" for key, value in fields.items()]
    _logger.info("startup " + " ".join(parts))


def slow_ms() -> float:
    return time.perf_counter() * 1000
