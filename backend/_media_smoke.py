"""媒体接口冒烟测试：presign → PUT → GET(range) → DELETE。

用法（先把后端跑起来）：
    python backend/_media_smoke.py http://127.0.0.1:8111
"""

from __future__ import annotations

import http.cookiejar
import json
import secrets
import sys
import urllib.error
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8111").rstrip("/")
JAR = http.cookiejar.CookieJar()
OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(JAR))

# 1x1 PNG
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360000002000154a24f6d0000000049454e44ae426082"
)

REGISTER = {
    "password": "nestory-test-123",
    "nickname": "media-test",
    "babyName": "nest",
    "babyBirthday": "2024-05-01",
}


def call(method: str, path: str, body: bytes | None = None, headers: dict | None = None):
    request = urllib.request.Request(BASE + path, data=body, method=method)
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    try:
        with OPENER.open(request, timeout=20) as response:
            return response.status, response.read(), dict(response.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(), dict(exc.headers)


def json_call(method: str, path: str, payload: dict | None = None):
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    status, raw, _ = call(method, path, body, {"Content-Type": "application/json"})
    return status, json.loads(raw or b"null")


def expect(label: str, ok: bool, detail: str = "") -> None:
    print(("ok   " if ok else "FAIL ") + label + (f" - {detail}" if detail else ""))
    if not ok:
        raise SystemExit(1)


def register() -> None:
    email = f"media-{secrets.token_hex(4)}@example.com"
    status, data = json_call("POST", "/api/auth/register", {"email": email, **REGISTER})
    expect("register", status == 200, str(data)[:160])


def main() -> None:
    register()

    status, info = json_call(
        "POST",
        "/api/media/presign",
        {"kind": "photo", "mime": "image/png", "bytes": len(PNG), "width": 1, "height": 1},
    )
    expect("presign", status == 200 and bool(info.get("id")), json.dumps(info, ensure_ascii=False))
    media_id = info["id"]
    url = info["url"]
    expect("presign mode", info.get("mode") in ("proxy", "s3"), str(info.get("mode")))

    status, _, _ = call("PUT", info["uploadUrl"], PNG, {"Content-Type": "image/png"})
    expect("upload", status == 200, str(status))

    status, raw, headers = call("GET", url)
    expect(
        "download",
        status == 200 and raw == PNG,
        f"{status} {len(raw)}B {headers.get('Content-Type')}",
    )

    status, raw, headers = call("GET", url, None, {"Range": "bytes=0-15"})
    expect(
        "range",
        status == 206
        and raw == PNG[:16]
        and headers.get("Content-Range") == f"bytes 0-15/{len(PNG)}",
        f"{status} {headers.get('Content-Range')}",
    )

    status, listing = json_call("GET", "/api/media")
    expect(
        "listing",
        status == 200 and listing["usage"]["items"] == 1 and listing["usage"]["bytes"] == len(PNG),
        json.dumps(listing["usage"], ensure_ascii=False),
    )

    status, _ = json_call("POST", f"/api/media/{media_id}/confirm", {"bytes": len(PNG)})
    expect("confirm", status == 200, str(status))

    status, _ = json_call("DELETE", f"/api/media/{media_id}")
    expect("delete", status == 200, str(status))

    status, _, _ = call("GET", url)
    expect("deleted 404", status == 404, str(status))

    status, listing = json_call("GET", "/api/media")
    expect(
        "usage after delete",
        status == 200 and listing["usage"]["items"] == 0,
        json.dumps(listing["usage"]),
    )

    # 别的用户读不到：登出后注册第二个账号
    json_call("POST", "/api/auth/logout")
    register()
    status, _, _ = call("GET", url)
    expect("cross-user 404", status == 404, str(status))

    # 配额：声明超过上限（默认 5 GB）直接被拒
    status, info = json_call(
        "POST",
        "/api/media/presign",
        {"kind": "video", "mime": "video/mp4", "bytes": 999 * 1024 * 1024 * 1024},
    )
    expect("oversize rejected", status == 413, str(status))

    print("\nall media checks passed")


if __name__ == "__main__":
    main()
