"""One-off smoke test against the deployed Nestory instance."""

import json
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
import http.cookiejar

ORIGIN = sys.argv[1] if len(sys.argv) > 1 else "https://nestory-nxqqnucm.usw-1.sealos.app"
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(method, path, body=None, headers=None, raw=False):
    url = path if path.startswith("http") else ORIGIN + path
    data = None
    hdrs = dict(headers or {})
    if body is not None:
        if isinstance(body, (bytes, bytearray)):
            data = bytes(body)
        else:
            data = json.dumps(body).encode()
            hdrs.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=data, method=method, headers=hdrs)
    try:
        with opener.open(req, timeout=90) as resp:
            payload = resp.read()
            return resp.status, dict(resp.headers), payload if raw else payload.decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        payload = exc.read()
        return exc.code, dict(exc.headers), payload if raw else payload.decode("utf-8", "replace")


def check(name, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))
    if not ok:
        sys.exit(1)


status, _, html = call("GET", "/")
check("index html", status == 200 and "Nestory" in html, str(status))

user = "claude" + secrets.token_hex(3)
status, _, body = call(
    "POST",
    "/api/auth/register",
    {"email": user + "@example.com", "password": "Nest0ry!pass", "babyName": "小满", "babyBirthday": "2024-05-01"},
)
check("register", status in (200, 201), f"{status} {body[:120]}")

blob = secrets.token_bytes(48 * 1024)
digest = __import__("hashlib").sha256(blob).hexdigest()
status, _, body = call(
    "POST",
    "/api/media/presign",
    {
        "kind": "photo",
        "mime": "image/jpeg",
        "bytes": len(blob),
        "sha256": digest,
        "width": 1200,
        "height": 900,
    },
)
check("presign", status == 200, f"{status} {body[:200]}")
presign = json.loads(body)
print("     mode=", presign.get("mode"), "expiresIn=", presign.get("expiresIn"))

status, headers, _ = call(
    "PUT",
    presign["uploadUrl"],
    blob,
    {"Content-Type": "image/jpeg"},
    raw=True,
)
check("direct upload", status in (200, 201, 204), str(status))

status, _, body = call("POST", f"/api/media/{presign['id']}/confirm", {})
check("confirm", status == 200, f"{status} {body[:120]}")

status, headers, data = call("GET", f"/api/media/blob/{presign['id']}", raw=True)
check("blob roundtrip", status == 200 and data == blob, f"{status} {len(data)}")

status, _, body = call("GET", "/api/media")
check("listing", status == 200 and presign["id"] in body, f"{status} {body[:160]}")

# browser-style CORS preflight against the object storage endpoint
origin = ORIGIN
parsed = urllib.parse.urlsplit(presign["uploadUrl"])
pre = urllib.request.Request(
    f"{parsed.scheme}://{parsed.netloc}{parsed.path}",
    method="OPTIONS",
    headers={
        "Origin": origin,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type",
    },
)
try:
    with urllib.request.urlopen(pre, timeout=30) as resp:
        cors = resp.headers.get("Access-Control-Allow-Origin")
        allow_methods = resp.headers.get("Access-Control-Allow-Methods")
        check("s3 cors preflight", bool(cors), f"origin={cors} methods={allow_methods}")
except urllib.error.HTTPError as exc:
    check("s3 cors preflight", False, f"HTTP {exc.code} {exc.headers.get('Access-Control-Allow-Origin')}")
except Exception as exc:  # noqa: BLE001
    check("s3 cors preflight", False, repr(exc))

status, _, body = call("DELETE", f"/api/media/{presign['id']}")
check("delete", status == 200, f"{status} {body[:120]}")
status, _, _ = call("GET", f"/api/media/blob/{presign['id']}")
check("deleted 404", status == 404, str(status))

print("deployed media smoke passed")
