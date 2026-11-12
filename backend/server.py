#!/usr/bin/env python3
"""Nestory 本地后端（MySQL 账号版）

前端启动先请求 ``GET /api/auth/me``：
    401 → 显示登录/注册页；200 → 用返回的``state``渲染首页。

运行：
    python backend/server.py            # http://127.0.0.1:8000
    python backend/server.py --port 9000 --no-ai-probe

账号接口：
    POST /api/auth/register   注册（写 users + 初始 AppState），成功后种会话 Cookie
    POST /api/auth/login      登录，返回用户与已保存的 AppState
    POST /api/auth/logout     退出，删除会话
    GET  /api/auth/me         当前会话 → {user, state}；未登录 401
    GET  /api/state           当前用户的 AppState（需登录）
    PUT  /api/state           保存 AppState（需登录）
    POST /api/state/reset     用示例数据重置当前用户（需登录）

其余为 AI 接口（见下方路由表）与健康检查。数据库未启动时账号接口返回 503，
AI 接口仍可用（它们只依赖请求里带过来的 state）。
"""

from __future__ import annotations

import argparse
import json
import logging
import mimetypes
import os
import sys
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))

import accounts  # noqa: E402
import ai_insights  # noqa: E402
import auth  # noqa: E402
import db  # noqa: E402
import fixtures  # noqa: E402
import llm  # noqa: E402
import logsetup  # noqa: E402
import quote as daily_quote  # noqa: E402
from app_state import build_state  # noqa: E402

MAX_BODY = 12 * 1024 * 1024  # 整份 AppState（含压缩后的照片 data URL）可能到几 MB

# 传了 --static-dir（或 NESTORY_STATIC_DIR）时，同一个进程顺带把 dist/ 发出去，
# 部署就只需要一个容器/一个端口；不传时行为和本地开发完全一致。
STATIC_DIR: Path | None = None

logger = logging.getLogger("nestory.http")


class Handler(BaseHTTPRequestHandler):
    server_version = "NestoryLocal/0.2"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    # ------------------------------------------------------------ 请求上下文

    def parse_request(self) -> bool:  # noqa: N802
        self._rid = uuid.uuid4().hex[:8]
        self._t0 = time.perf_counter()
        self._uid: int | None = None
        return super().parse_request()

    def _set_user(self, user: dict) -> None:
        self._uid = user.get("id")

    # ------------------------------------------------------------ 响应工具

    def _send_json(self, payload: dict, status: int = 200, headers: dict | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept")
            for key, value in (headers or {}).items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass  # 浏览器提前撤销请求（快速刷新/关页）时不算错误

    def _ok(self, payload: dict, status: int = 200, headers: dict | None = None) -> None:
        self._send_json(payload, status, headers)
        self._log(status, len(json.dumps(payload, ensure_ascii=False)))

    def _fail(self, exc: accounts.ApiError) -> None:
        self._send_json({"error": exc.code, "message": exc.message}, exc.status)
        self._log(exc.status, 0)

    def _error(self, status: int, code: str, message: str) -> None:
        self._send_json({"error": code, "message": message}, status)
        self._log(status, 0)

    def _internal(self) -> None:
        logger.exception(
            "rid=%s unhandled error %s %s",
            getattr(self, "_rid", "-"),
            self.command,
            urlsplit(self.path).path,
        )
        try:
            self._send_json(
                {"error": "internal_error", "message": "服务端出错了，请查看控制台日志"},
                500,
            )
            self._log(500, 0)
        except Exception:  # noqa: BLE001 - 响应可能已经发出去一半
            pass

    # ------------------------------------------------------------ 请求体

    def _read_json(self, allow_empty: bool = False) -> dict:
        raw_len = self.headers.get("Content-Length")
        try:
            length = int(raw_len) if raw_len else 0
        except ValueError:
            raise ValueError("invalid Content-Length")
        if length <= 0:
            if allow_empty:
                return {}
            raise ValueError("empty body")
        if length > MAX_BODY:
            raise ValueError("body too large")
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise ValueError("invalid json")
        if not isinstance(payload, dict):
            raise ValueError("body must be a JSON object")
        return payload

    @staticmethod
    def _validate_state(state: dict) -> None:
        if state.get("version") != 3:
            raise ValueError("state.version must be 3")
        for key in ("feeds", "sleeps", "diapers", "growths", "milestones", "photos"):
            if not isinstance(state.get(key), list):
                raise ValueError(f"state.{key} must be a list")

    def _read_state(self) -> dict:
        payload = self._read_json()
        # 既接受 {state: ...}，也接受直接抛过来的 AppState
        state = payload.get("state") if "state" in payload else payload
        if not isinstance(state, dict):
            raise ValueError("state must be an object")
        self._validate_state(state)
        return state

    # ------------------------------------------------------------ 会话

    def _token(self) -> str | None:
        return auth.parse_cookie(self.headers.get("Cookie"))

    def _authed(self) -> tuple[dict, dict] | None:
        try:
            user, state = accounts.me(self._token())
        except accounts.ApiError as exc:
            self._fail(exc)
            return None
        self._set_user(user)
        return user, state

    # ------------------------------------------------------------ 路由

    def do_GET(self) -> None:  # noqa: N802
        try:
            self._handle_get()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            return
        except Exception:  # noqa: BLE001
            self._internal()

    def _handle_get(self) -> None:
        parsed = urlsplit(self.path)
        path = parsed.path.rstrip("/") or "/"
        query = parse_qs(parsed.query)

        # 配了 --static-dir 时 "/" 交给前端 dist，" /api" 始终是自述接口
        if path == "/api" or (path == "/" and STATIC_DIR is None):
            ai = llm.config()
            self._ok(
                {
                    "service": "nestory-local-backend",
                    "version": 2,
                    "phase": "mysql",
                    "endpoints": [
                        "GET /api/health",
                        "POST /api/auth/register",
                        "POST /api/auth/login",
                        "POST /api/auth/logout",
                        "GET /api/auth/me",
                        "GET /api/state",
                        "PUT /api/state",
                        "POST /api/state/reset",
                        "POST /api/ai/summary",
                        "POST /api/ai/analysis",
                        "POST /api/ai/story",
                        "POST /api/daily-quote",
                    ],
                    "ai": {"provider": ai["provider"], "model": ai["model"]},
                }
            )
            return

        if path == "/api/health":
            ai = llm.config()
            db_ok, db_detail = db.ping()
            self._ok(
                {
                    "status": "ok" if db_ok else "degraded",
                    "time": int(time.time() * 1000),
                    "timezone": time.strftime("%Z"),
                    "db": {"ok": db_ok, "detail": db_detail},
                    "ai": {
                        "provider": ai["provider"],
                        "model": ai["model"],
                        "configured": bool(ai["key"]) or ai["provider"] == "pollinations",
                    },
                }
            )
            return

        if path == "/api/auth/me":
            try:
                user, state = accounts.me(self._token())
            except accounts.ApiError as exc:
                self._fail(exc)
                return
            self._set_user(user)
            self._ok({"user": user, "state": state})
            return

        if path == "/api/state":
            got = self._authed()
            if got is None:
                return
            user, state = got
            self._ok({"source": "mysql", "state": state, "user": user})
            return

        if path == "/api/test-config":
            self._ok({"source": "src/data/test_config.js", "data": fixtures.as_dict()})
            return

        if STATIC_DIR is not None and self._serve_static(parsed.path):
            return

        self._error(404, "not_found", path)

    # ------------------------------------------------------------ 静态资源

    def _serve_static(self, raw_path: str) -> bool:
        """把构建好的前端目录当作单页应用发出去。

        只认 ``--static-dir`` 指定的根目录；没传就永远不会被调用，本地开发行为不变。
        返回 True 表示已经响应，False 表示交给后面的 404。
        """
        assert STATIC_DIR is not None
        root = STATIC_DIR
        try:
            rel = unquote(raw_path).lstrip("/") or "index.html"
            target = (root / rel).resolve()
        except (OSError, ValueError):
            return False
        if target != root and root not in target.parents:
            return False  # 挡住 ../ 之类的目录穿越
        if target.is_dir():
            target = target / "index.html"
        if not target.is_file():
            if Path(rel).suffix:
                return False  # 缺失的静态文件老实还 404
            target = root / "index.html"  # 前端路由（/album、/growth…）回落到入口
            if not target.is_file():
                return False
        try:
            body = target.read_bytes()
        except OSError:
            return False

        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in (
            "application/javascript",
            "application/json",
            "image/svg+xml",
        ):
            ctype = f"{ctype}; charset=utf-8"
        cache = (
            "no-cache"
            if target.name in ("index.html", "sw.js")
            else "public, max-age=31536000, immutable"
        )
        try:
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", cache)
            self.end_headers()
            self.wfile.write(body)
            self._log(200, len(body))
        except (BrokenPipeError, ConnectionResetError):
            return True
        return True

    def do_POST(self) -> None:  # noqa: N802
        try:
            self._handle_post()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            return
        except Exception:  # noqa: BLE001
            self._internal()

    def _handle_post(self) -> None:
        path = urlsplit(self.path).path.rstrip("/") or "/"

        auth_routes = {
            "/api/auth/register": self._register,
            "/api/auth/login": self._login,
            "/api/auth/logout": self._logout,
            "/api/state/reset": self._reset_state,
        }
        ai_routes = {
            "/api/ai/summary": self._ai_summary,
            "/api/ai/analysis": self._ai_analysis,
            "/api/ai/story": self._ai_story,
            "/api/daily-quote": self._daily_quote,
        }

        if path in auth_routes:
            auth_routes[path]()
            return

        handler = ai_routes.get(path)
        if handler is None:
            self._error(404, "not_found", path)
            return

        try:
            state = self._read_state()
        except ValueError as exc:
            self._error(400, "bad_request", str(exc))
            return
        handler(state)

    def do_PUT(self) -> None:  # noqa: N802
        try:
            self._handle_put()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            return
        except Exception:  # noqa: BLE001
            self._internal()

    def _handle_put(self) -> None:
        path = urlsplit(self.path).path.rstrip("/") or "/"
        if path != "/api/state":
            self._error(404, "not_found", path)
            return
        try:
            state = self._read_state()
        except ValueError as exc:
            self._error(400, "bad_request", str(exc))
            return
        try:
            result = accounts.save_state(self._token(), state)
        except accounts.ApiError as exc:
            self._fail(exc)
            return
        self._uid = result.pop("userId", None)
        self._ok({"source": "mysql", **result, "state": state})

    # ------------------------------------------------------------ 账号处理

    def _register(self) -> None:
        try:
            data = self._read_json()
            user, state, token = accounts.register(data)
        except ValueError as exc:
            self._error(400, "bad_request", str(exc))
            return
        except accounts.ApiError as exc:
            self._fail(exc)
            return
        self._set_user(user)
        self._ok(
            {"source": "mysql", "user": user, "state": state},
            headers={"Set-Cookie": auth.cookie_header(token)},
        )

    def _login(self) -> None:
        try:
            data = self._read_json()
            user, state, token = accounts.login(data)
        except ValueError as exc:
            self._error(400, "bad_request", str(exc))
            return
        except accounts.ApiError as exc:
            self._fail(exc)
            return
        self._set_user(user)
        self._ok(
            {"source": "mysql", "user": user, "state": state},
            headers={"Set-Cookie": auth.cookie_header(token)},
        )

    def _logout(self) -> None:
        try:
            accounts.logout(self._token())
        except accounts.ApiError as exc:
            self._fail(exc)
            return
        self._ok({"ok": True}, headers={"Set-Cookie": auth.clear_cookie()})

    def _reset_state(self) -> None:
        try:
            result = accounts.reset_state(self._token())
        except accounts.ApiError as exc:
            self._fail(exc)
            return
        self._ok({"source": "mysql", **result})

    # ------------------------------------------------------------ AI

    def _send_ai(self, payload: dict, tag: str, note: str, elapsed: int) -> None:
        self._ok(payload)
        logger.info(
            "rid=%s ai tag=%s provider=%s model=%s elapsed=%dms chars=%d note=%r",
            self._rid,
            tag,
            payload.get("provider", "?"),
            payload.get("model", "?"),
            elapsed,
            len(note),
            note[:60],
        )

    def _ai_summary(self, state: dict) -> None:
        result = llm.generate(state)
        now = int(time.time() * 1000)
        milestone = {
            "id": f"ms_ai_{now}",
            "at": now,
            "title": result["title"],
            "note": result["note"],
            "kind": "milestone",
        }
        new_state = {**state, "milestones": [*state.get("milestones", []), milestone]}
        payload = {
            "source": "ai",
            "generatedAt": now,
            "elapsedMs": result["elapsedMs"],
            "provider": result["provider"],
            "model": result["model"],
            "ai": result,
            "state": new_state,
        }
        self._send_ai(payload, "summary", result["title"], result["elapsedMs"])

    def _ai_analysis(self, state: dict) -> None:
        result = ai_insights.analysis(state)
        now = int(time.time() * 1000)
        payload = {
            "source": "ai",
            "generatedAt": now,
            "elapsedMs": result["elapsedMs"],
            "provider": result["provider"],
            "model": result["model"],
            "analysis": result["analysis"],
        }
        self._send_ai(payload, "analysis", result["analysis"]["headline"], result["elapsedMs"])

    def _ai_story(self, state: dict) -> None:
        result = ai_insights.story(state)
        now = int(time.time() * 1000)
        payload = {
            "source": "ai",
            "generatedAt": now,
            "elapsedMs": result["elapsedMs"],
            "provider": result["provider"],
            "model": result["model"],
            "story": result["story"],
        }
        self._send_ai(payload, "story", result["story"]["title"], result["elapsedMs"])

    def _daily_quote(self, state: dict) -> None:
        result = daily_quote.daily(state)
        payload = {"source": "ai", "generatedAt": int(time.time() * 1000), **result}
        self._send_ai(payload, "quote", result["quote"]["text"], result["elapsedMs"])

    # ------------------------------------------------------------ 其他方法

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self) -> None:  # noqa: N802
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _log(self, status: int, size: int) -> None:
        started = getattr(self, "_t0", None)
        if started is None:
            return
        ms = (time.perf_counter() - started) * 1000
        level = logging.INFO if status < 400 else logging.WARNING if status < 500 else logging.ERROR
        path = urlsplit(self.path).path
        logger.log(
            level,
            "rid=%s %s %s -> %d %.1fms %dB user=%s%s",
            self._rid,
            self.command,
            path,
            status,
            ms,
            size,
            self._uid if self._uid is not None else "-",
            " slow" if ms >= 1500 else "",
        )

    def handle(self) -> None:
        try:
            super().handle()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            return

    def log_message(self, fmt: str, *args) -> None:
        return


def main() -> int:
    global STATIC_DIR
    parser = argparse.ArgumentParser(description="Nestory local backend (MySQL accounts + AI)")
    parser.add_argument("--host", default="127.0.0.1", help="bind host (default 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="bind port (default 8000)")
    parser.add_argument(
        "--static-dir",
        default=os.environ.get("NESTORY_STATIC_DIR"),
        help="serve a built frontend from this dir (SPA fallback); env NESTORY_STATIC_DIR",
    )
    parser.add_argument("--no-ai-probe", action="store_true", help="skip the startup AI probe")
    parser.add_argument("--log-level", default=None, help="DEBUG / INFO / WARNING / ERROR (default INFO)")
    parser.add_argument("--log-dir", default=None, help="where nestory.log lives (default backend/logs)")
    parser.add_argument("--no-log-file", action="store_true", help="console output only")
    args = parser.parse_args()

    # Windows 控制台默认 cp1252，打印中文会抛 UnicodeEncodeError 并打断请求线程
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass

    log_level = (args.log_level or os.environ.get("NESTORY_LOG_LEVEL") or "INFO").upper()
    log_dir = args.log_dir or os.environ.get("NESTORY_LOG_DIR")
    log = logsetup.setup(level=log_level, log_dir=log_dir, file=not args.no_log_file)
    logsetup.install_exception_hooks(log)

    if args.static_dir:
        candidate = Path(args.static_dir).expanduser().resolve()
        if (candidate / "index.html").is_file():
            STATIC_DIR = candidate
        else:
            print(f"static   : ignored, no index.html in {candidate}", flush=True)

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True

    print("Nestory local backend", flush=True)
    print(f"  http://{args.host}:{args.port}/", flush=True)
    if STATIC_DIR is not None:
        print(f"  static   : {STATIC_DIR}", flush=True)

    cfg = db.config()
    print("MySQL", flush=True)
    print(f"  target   : {cfg['user']}@{cfg['host']}:{cfg['port']}/{cfg['database']}", flush=True)
    db_ok, db_detail = db.ping()
    print(f"  ping     : {'ok' if db_ok else 'FAILED'} · {db_detail}", flush=True)
    if db_ok:
        try:
            db.init_schema()
            print("  schema   : ready (users / sessions / user_state)", flush=True)
        except Exception as exc:  # noqa: BLE001
            print(f"  schema   : FAILED · {exc}", flush=True)
    else:
        print("  note     : accounts need MySQL; AI pages still work", flush=True)

    ai = llm.config()
    print("AI model", flush=True)
    print(f"  provider : {ai['provider']}", flush=True)
    print(f"  host     : {ai['host']}", flush=True)
    print(f"  model    : {ai['model']}", flush=True)
    print(f"  key      : {ai['key'] or '(none)'}", flush=True)
    if ai["source"] == "llm.env":
        print(f"  config   : llm.env ({len(ai['envApplied'])} active keys)", flush=True)
    elif ai["source"] == "mixed":
        print("  config   : environment variables + llm.env", flush=True)
    elif ai["source"] == "environment":
        print("  config   : environment variables", flush=True)
    else:
        print("  config   : built-in defaults", flush=True)
    if args.no_ai_probe:
        print("  probe    : skipped (--no-ai-probe)", flush=True)
    else:
        ok, detail, ms = llm.probe()
        print(f"  probe    : {'ok' if ok else 'FAILED'} via {detail} ({ms} ms)", flush=True)
        if not ok:
            print("  note     : model unavailable; pages fall back to built-in copy", flush=True)

    print("  Ctrl+C to stop", flush=True)

    logsetup.startup_line(
        host=args.host,
        port=args.port,
        db=f"{cfg['host']}:{cfg['port']}/{cfg['database']}",
        db_ok=db_ok,
        ai=f"{ai['provider']}/{ai['model']}",
        level=log_level,
        log=logsetup.log_file() or "console-only",
    )

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye", flush=True)
    finally:
        log.info("shutdown")
        server.server_close()
        logsetup.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
