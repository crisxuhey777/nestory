"""媒体文件存储：S3 兼容对象存储，或本地磁盘（开发用）。

设计原则：
- 后端只做「签名 + 登记」，字节流尽量让浏览器直传对象存储，不过应用服务器；
- 没配 S3 时自动退回本地目录 ``backend/media/``，本地开发和 e2e 都能跑；
- 两边接口一样，上层（media.py / server.py）不关心底下是谁。

环境变量：
    NESTORY_S3_ENDPOINT     https://<account>.r2.cloudflarestorage.com 或 MinIO 地址
    NESTORY_S3_BUCKET       桶名
    NESTORY_S3_REGION       默认 auto（R2 用 auto，MinIO 用 us-east-1 也行）
    NESTORY_S3_ACCESS_KEY   Access Key
    NESTORY_S3_SECRET_KEY   Secret Key
    NESTORY_S3_PREFIX       对象前缀，默认 nestory
    NESTORY_S3_CDN_BASE     可选：公开/CDN 域名，配了就直连，不再走 302
    NESTORY_MEDIA_DIR       本地驱动目录，默认 backend/media
"""

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import mimetypes
import os
import shutil
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

ENV = {
    "endpoint": "NESTORY_S3_ENDPOINT",
    "bucket": "NESTORY_S3_BUCKET",
    "region": "NESTORY_S3_REGION",
    "access_key": "NESTORY_S3_ACCESS_KEY",
    "secret_key": "NESTORY_S3_SECRET_KEY",
    "prefix": "NESTORY_S3_PREFIX",
    "cdn_base": "NESTORY_S3_CDN_BASE",
    "media_dir": "NESTORY_MEDIA_DIR",
    "max_mb": "NESTORY_MEDIA_MAX_MB",
    "quota_mb": "NESTORY_MEDIA_QUOTA_MB",
}

DEFAULTS = {
    "endpoint": "",
    "bucket": "",
    "region": "auto",
    "access_key": "",
    "secret_key": "",
    "prefix": "nestory",
    "cdn_base": "",
    "media_dir": str(BASE_DIR / "media"),
    "max_mb": "200",
    "quota_mb": "5120",
}

_ENV_FILE = {"path": str(BASE_DIR / "media.env"), "found": False}


def _load_env_file() -> None:
    """读取同目录 media.env 的 KEY=VALUE；已存在的环境变量不覆盖。"""
    path = _ENV_FILE["path"]
    if not os.path.isfile(path):
        return
    _ENV_FILE["found"] = True
    with open(path, "r", encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and value and key not in os.environ:
                os.environ[key] = value


_load_env_file()


def config() -> dict:
    cfg = dict(DEFAULTS)
    for field, key in ENV.items():
        value = os.environ.get(key)
        if value is not None and value.strip():
            cfg[field] = value.strip()
    cfg["endpoint"] = cfg["endpoint"].rstrip("/")
    cfg["bucket"] = cfg["bucket"].strip("/")
    cfg["prefix"] = cfg["prefix"].strip("/")
    cfg["cdn_base"] = cfg["cdn_base"].rstrip("/")
    return cfg


def driver() -> str | None:
    """s3 / local；一个都配不上时返回 None（媒体接口会回 503）。"""
    cfg = config()
    if cfg["endpoint"] and cfg["bucket"] and cfg["access_key"] and cfg["secret_key"]:
        return "s3"
    if cfg["media_dir"]:
        return "local"
    return None


def _mb(value, default_mb: int) -> int:
    try:
        return max(1, int(float(value) * 1024 * 1024))
    except (TypeError, ValueError):
        return default_mb * 1024 * 1024


def max_bytes() -> int:
    return _mb(config()["max_mb"], 50)


def quota_bytes() -> int:
    return _mb(config()["quota_mb"], 5120)


def _endpoint_prefix(cfg: dict) -> str:
    """endpoint 自带路径时（如 MinIO 的 http://host/minio）不能把它丢掉。"""
    path = urllib.parse.urlsplit(cfg["endpoint"]).path.strip("/")
    return f"/{path}" if path else ""


def _object_path(cfg: dict, key: str = "") -> str:
    base = f"{_endpoint_prefix(cfg)}/{cfg['bucket']}"
    return f"{base}/{key.lstrip('/')}" if key else base


def object_key(user_id: int, media_id: str, mime: str) -> str:
    ext = mimetypes.guess_extension(mime or "") or ".bin"
    if ext == ".jpe":
        ext = ".jpg"
    return f"{config()['prefix']}/{user_id}/{media_id}{ext}"


# ---------------------------------------------------------------- 本地驱动


def _local_root() -> Path:
    root = Path(config()["media_dir"]).expanduser()
    root.mkdir(parents=True, exist_ok=True)
    return root


def local_path(key: str) -> Path:
    return _local_root() / key


def write_local(key: str, data: bytes) -> int:
    path = local_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".part")
    tmp.write_bytes(data)
    tmp.replace(path)
    return len(data)


# ---------------------------------------------------------------- SigV4

_ALGO = "AWS4-HMAC-SHA256"


def _hmac(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def _signing_key(secret: str, date: str, region: str, service: str = "s3") -> bytes:
    k = _hmac(("AWS4" + secret).encode("utf-8"), date)
    k = _hmac(k, region)
    k = _hmac(k, service)
    return _hmac(k, "aws4_request")


def _uri_encode(value: str, safe: str = "") -> str:
    return urllib.parse.quote(value, safe=safe)


def _canonical_uri(key: str) -> str:
    return "/" + "/".join(_uri_encode(seg) for seg in key.lstrip("/").split("/"))


def _host(cfg: dict) -> str:
    parsed = urllib.parse.urlsplit(cfg["endpoint"])
    host = parsed.netloc
    return host


def _base_url(cfg: dict) -> str:
    parsed = urllib.parse.urlsplit(cfg["endpoint"])
    return f"{parsed.scheme}://{parsed.netloc}"


def presign(method: str, key: str, expires: int = 3600, content_type: str = "") -> str:
    """返回可直接给浏览器用的预签名 URL（PUT 上传 / GET 下载都走它）。"""
    cfg = config()
    now = dt.datetime.now(dt.timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    scope = f"{date_stamp}/{cfg['region']}/s3/aws4_request"
    host = _host(cfg)
    path = _object_path(cfg, key)
    canonical_uri = _canonical_uri(path)

    query = {
        "X-Amz-Algorithm": _ALGO,
        "X-Amz-Credential": f"{cfg['access_key']}/{scope}",
        "X-Amz-Date": amz_date,
        "X-Amz-Expires": str(int(expires)),
        "X-Amz-SignedHeaders": "host",
    }
    canonical_query = "&".join(
        f"{_uri_encode(k)}={_uri_encode(v)}" for k, v in sorted(query.items())
    )

    canonical_request = "\n".join(
        [
            method.upper(),
            canonical_uri,
            canonical_query,
            f"host:{host}\n",
            "host",
            "UNSIGNED-PAYLOAD",
        ]
    )
    string_to_sign = "\n".join(
        [
            _ALGO,
            amz_date,
            scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ]
    )
    signature = hmac.new(
        _signing_key(cfg["secret_key"], date_stamp, cfg["region"]),
        string_to_sign.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    return (
        f"{_base_url(cfg)}{canonical_uri}?{canonical_query}"
        f"&X-Amz-Signature={signature}"
    )


def _query_string(query: dict[str, str] | None) -> str:
    if not query:
        return ""
    return "&".join(
        f"{_uri_encode(k)}={_uri_encode(str(v))}" for k, v in sorted(query.items())
    )


def _signed_request(
    method: str,
    key: str,
    body: bytes = b"",
    content_type: str = "",
    query: dict[str, str] | None = None,
) -> urllib.request.Request:
    """服务端自己发请求时用（代理上传、删除、列目录）。"""
    cfg = config()
    now = dt.datetime.now(dt.timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    scope = f"{date_stamp}/{cfg['region']}/s3/aws4_request"
    host = _host(cfg)
    canonical_uri = _canonical_uri(_object_path(cfg, key))
    canonical_query = _query_string(query)
    payload_hash = hashlib.sha256(body).hexdigest()

    headers = {"Host": host, "X-Amz-Date": amz_date}
    if body:
        # 带 body 的请求必须把 payload 的 sha256 放进签名头，否则 S3 判 SignatureDoesNotMatch
        headers["X-Amz-Content-Sha256"] = payload_hash
    if content_type:
        headers["Content-Type"] = content_type
    signed_headers = ";".join(sorted(h.lower() for h in headers))
    canonical_headers = "".join(
        f"{k.lower()}:{headers[k].strip()}\n" for k in sorted(headers)
    )
    canonical_request = "\n".join(
        [
            method.upper(),
            canonical_uri,
            canonical_query,
            canonical_headers,
            signed_headers,
            payload_hash,
        ]
    )
    string_to_sign = "\n".join(
        [
            _ALGO,
            amz_date,
            scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ]
    )
    signature = hmac.new(
        _signing_key(cfg["secret_key"], date_stamp, cfg["region"]),
        string_to_sign.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    headers["Authorization"] = (
        f"{_ALGO} Credential={cfg['access_key']}/{scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    headers.pop("Host")
    url = f"{_base_url(cfg)}{canonical_uri}"
    if canonical_query:
        url = f"{url}?{canonical_query}"
    return urllib.request.Request(
        url,
        data=body if body else None,
        method=method.upper(),
        headers=headers,
    )


def _send(method: str, key: str, body: bytes = b"", content_type: str = "") -> None:
    request = _signed_request(method, key, body, content_type)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read(300).decode("utf-8", "replace")
        raise RuntimeError(f"{method} {key} failed: {exc.code} {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"{method} {key} failed: {exc.reason}") from exc


# ---------------------------------------------------------------- 统一接口


def put(key: str, data: bytes, content_type: str = "") -> int:
    mode = driver()
    if mode == "s3":
        _send("PUT", key, data, content_type)
    elif mode == "local":
        write_local(key, data)
    else:
        raise RuntimeError("no storage configured")
    return len(data)


def put_stream(key: str, path: Path, content_type: str = "") -> int:
    """大文件用：本地直接搬走，S3 走预签名 PUT 流式上传，不把整段视频读进内存。"""
    size = path.stat().st_size
    mode = driver()
    if mode == "local":
        target = local_path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(path), str(target))
        return size
    if mode == "s3":
        url = presign("PUT", key, 900)
        with path.open("rb") as fh:
            request = urllib.request.Request(url, data=fh, method="PUT")
            request.add_header("Content-Type", content_type or "application/octet-stream")
            request.add_header("Content-Length", str(size))
            try:
                with urllib.request.urlopen(request, timeout=120) as response:
                    response.read()
            except urllib.error.HTTPError as exc:
                detail = exc.read(300).decode("utf-8", "replace")
                raise RuntimeError(f"PUT {key} failed: {exc.code} {detail}") from exc
            except urllib.error.URLError as exc:
                raise RuntimeError(f"PUT {key} failed: {exc.reason}") from exc
        return size
    raise RuntimeError("no storage configured")


def list_keys(prefix: str = "", limit: int = 1000) -> list[str]:
    """列出某个前缀下的对象键（备份清理用）。"""
    mode = driver()
    if mode == "local":
        root = _local_root()
        if not root.exists():
            return []
        wanted = prefix.strip("/")
        found = []
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            key = path.relative_to(root).as_posix()
            if not wanted or key.startswith(wanted):
                found.append(key)
        return sorted(found)[:limit]
    if mode != "s3":
        return []
    keys: list[str] = []
    token = ""
    while True:
        query = {"list-type": "2", "prefix": prefix, "max-keys": "1000"}
        if token:
            query["continuation-token"] = token
        request = _signed_request("GET", "", query=query)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                payload = response.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read(300).decode("utf-8", "replace")
            raise RuntimeError(f"LIST {prefix} failed: {exc.code} {detail}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"LIST {prefix} failed: {exc.reason}") from exc
        root = ET.fromstring(payload)
        for node in root.findall(".//{*}Contents/{*}Key"):
            if node.text:
                keys.append(node.text)
        truncated = root.findtext(".//{*}IsTruncated") == "true"
        token = root.findtext(".//{*}NextContinuationToken") or ""
        if not truncated or not token or len(keys) >= limit:
            break
    return keys[:limit]


def object_size(key: str) -> int | None:
    """对象真实大小；还没上传/已不存在时返回 None。

    confirm 用它在服务端核对字节数，避免客户端把 2GB 报成 1B 绕过配额。
    """
    mode = driver()
    if mode == "local":
        path = local_path(key)
        try:
            return path.stat().st_size if path.is_file() else None
        except OSError:
            return None
    if mode != "s3":
        return None
    request = _signed_request("HEAD", key)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.headers.get("Content-Length") or ""
            return int(raw) if raw.isdigit() else None
    except urllib.error.HTTPError as exc:
        if exc.code in (403, 404):
            return None
        raise RuntimeError(f"HEAD {key} failed: {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"HEAD {key} failed: {exc.reason}") from exc


def delete(key: str) -> None:
    mode = driver()
    if mode == "s3":
        _send("DELETE", key)
    elif mode == "local":
        path = local_path(key)
        if path.exists():
            path.unlink()


def download(key: str) -> bytes:
    """服务端取回整个对象（恢复备份用；大文件请走流式）。"""
    mode = driver()
    if mode == "local":
        return local_path(key).read_bytes()
    if mode != "s3":
        raise RuntimeError("no storage configured")
    request = _signed_request("GET", key)
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read(300).decode("utf-8", "replace")
        raise RuntimeError(f"GET {key} failed: {exc.code} {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"GET {key} failed: {exc.reason}") from exc


def get_url(key: str, expires: int = 3600) -> str:
    """给浏览器读文件的地址：配了 CDN 就直接拼，否则给预签名 URL。"""
    cfg = config()
    if cfg["cdn_base"]:
        return f"{cfg['cdn_base']}/{key.lstrip('/')}"
    return presign("GET", key, expires)


def upload_url(key: str, content_type: str = "", expires: int = 900) -> str:
    return presign("PUT", key, expires, content_type)
