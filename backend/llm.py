#!/usr/bin/env python3
"""免费大模型适配层（无需 API Key）

默认走 Pollinations 的文本 GET 接口：
    GET https://text.pollinations.ai/<urlencoded prompt>?model=openai

这个接口目前免密钥可用（POST /openai 会返回 402，所以这里用 GET）。
如果网络不可用、被限流或返回内容无法解析，会自动退回本地规则生成，
保证前端一定能收到一条结构正确的小结。

想换成任何 OpenAI 兼容服务，二选一：

1) 编辑同目录的 `backend/llm.env`（推荐，双击 bat 启动时也能生效）：
       NESTORY_LLM_BASE=https://api.example.com/v1/chat/completions
       NESTORY_LLM_KEY=sk-...
       NESTORY_LLM_MODEL=...
       NESTORY_LLM_TIMEOUT=45

2) 或用环境变量（真实环境变量优先于 llm.env）。
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta


log = logging.getLogger("nestory.ai")
_ENV_FILE = {"path": "", "found": False, "applied": []}


def _load_env_file() -> None:
    """读取同目录 llm.env 的 KEY=VALUE；已存在的环境变量不覆盖。"""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "llm.env")
    _ENV_FILE["path"] = path
    try:
        with open(path, "r", encoding="utf-8") as fh:
            _ENV_FILE["found"] = True
            for raw in fh:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and value and key not in os.environ:
                    os.environ[key] = value
                    _ENV_FILE["applied"].append(key)
    except (FileNotFoundError, OSError):
        pass


_load_env_file()

POLLINATIONS = "https://text.pollinations.ai/"
TIMEOUT = float(os.environ.get("NESTORY_LLM_TIMEOUT", "45"))


def config() -> dict:
    """当前生效的模型配置（启动横幅与 /api/health 共用）。"""
    base = os.environ.get("NESTORY_LLM_BASE", "").strip()
    model = os.environ.get("NESTORY_LLM_MODEL", "").strip()
    if not model:
        model = "gpt-4o-mini" if base else "openai"
    key = os.environ.get("NESTORY_LLM_KEY", "").strip()
    applied = set(_ENV_FILE["applied"])
    configured = {
        name
        for name in ("NESTORY_LLM_BASE", "NESTORY_LLM_KEY", "NESTORY_LLM_MODEL")
        if os.environ.get(name)
    }
    if not configured:
        source = "defaults"
    elif configured <= applied:
        source = "llm.env"
    elif applied:
        source = "mixed"
    else:
        source = "environment"
    return {
        "provider": "openai-compatible" if base else "pollinations",
        "base": base or POLLINATIONS,
        "host": urllib.parse.urlsplit(base).netloc if base else "text.pollinations.ai",
        "model": model,
        "key": ("***" + key[-4:]) if key else "",
        "timeout": TIMEOUT,
        "envFile": _ENV_FILE["path"] if _ENV_FILE["found"] else "",
        "envApplied": list(_ENV_FILE["applied"]),
        "source": source,
    }


VISION_DEFAULT_BASE = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
VISION_MAX_BYTES = 3 * 1024 * 1024


class VisionError(RuntimeError):
    """视觉模型不可用或返回不可解析时抛出；status 供 HTTP 层映射。"""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def vision_config() -> dict:
    """视觉模型配置。Key 只从后端环境 / llm.env 读取，不返回给前端。"""
    base = os.environ.get("NESTORY_VISION_BASE", "").strip() or VISION_DEFAULT_BASE
    model = os.environ.get("NESTORY_VISION_MODEL", "").strip() or "glm-4v-flash"
    key = os.environ.get("NESTORY_VISION_KEY", "").strip()
    applied = set(_ENV_FILE["applied"])
    names = ("NESTORY_VISION_BASE", "NESTORY_VISION_KEY", "NESTORY_VISION_MODEL")
    configured = {name for name in names if os.environ.get(name)}
    if not configured:
        source = "defaults"
    elif configured <= applied:
        source = "llm.env"
    elif applied:
        source = "mixed"
    else:
        source = "environment"
    return {
        "configured": bool(key),
        "provider": "openai-compatible",
        "base": base,
        "host": urllib.parse.urlsplit(base).netloc,
        "model": model,
        "key": ("***" + key[-4:]) if key else "",
        "timeout": TIMEOUT,
        "source": source,
    }


def _vision_titles(raw: str) -> list[str]:
    data = parse_json(raw)
    values = data.get("titles") if data else None
    items: list[str] = []
    if isinstance(values, list):
        items = [str(item) for item in values]
    else:
        # 模型偶尔不按 JSON 返回：逐行取，去掉编号和引号
        items = [line for line in re.split(r"[\r\n]+", raw or "") if line.strip()]
    cleaned: list[str] = []
    for item in items:
        title = re.sub(r"^[\s\-*•·\d.、)）]+", "", item).strip()
        title = title.strip().strip('"“”\'')
        title = re.sub(r"\s+", " ", title)
        if not title:
            continue
        title = title[:18]
        if title not in cleaned:
            cleaned.append(title)
        if len(cleaned) == 3:
            break
    return cleaned


def _prepare_image(image_data_url: str) -> str:
    """校验内联压缩图；只接受 data URL，避免后端被当作抓取任意 URL 的代理。"""
    image = (image_data_url or "").strip()
    if not re.match(r"^data:image/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=\s]+$", image):
        raise VisionError("图片格式不支持", 400)
    payload = image.split(",", 1)[1]
    if len(payload) * 3 // 4 > VISION_MAX_BYTES:
        raise VisionError("图片太大，请压缩后再试", 413)
    try:
        base64.b64decode(re.sub(r"\s+", "", payload), validate=True)
    except (ValueError, TypeError):
        raise VisionError("图片数据不完整", 400) from None
    return image


def caption(image_data_url: str, hint: str = "") -> dict:
    """让视觉模型给这张照片起 3 条候选标题。

    image_data_url 必须是压缩后的 data:image/...;base64,...；不接受任意 URL，
    避免把后端当代理去抓内网地址。密钥只在后端使用，不写入日志。
    """
    cfg = vision_config()
    if not cfg["configured"]:
        raise VisionError("视觉模型还没配置", 503)

    image = _prepare_image(image_data_url)

    safe_hint = re.sub(r"[\r\n\t]+", " ", hint or "").strip()[:80]
    prompt = (
        "你是家庭相册的编辑。看这张照片，写 3 条中文短标题，每条不超过 12 个字。"
        "要具体、温柔、克制，像写在相册背面的一句话；不要感叹号，不要夸张，不要评价长相。"
        "不要出现宝宝姓名、地点等隐私。"
        + (f"参考信息：{safe_hint}。" if safe_hint else "")
        + '只输出 JSON：{"titles":["...","...","..."]}'
    )
    body = json.dumps(
        {
            "model": cfg["model"],
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": image}},
                    ],
                }
            ],
            "temperature": 0.6,
            "max_tokens": 300,
        }
    ).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Nestory/1.0",
        "Authorization": "Bearer " + os.environ["NESTORY_VISION_KEY"],
    }
    started = time.time()
    req = urllib.request.Request(cfg["base"], data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        log.warning("vision http %s", exc.code)
        if exc.code in (401, 403):
            raise VisionError("视觉模型 Key 无效或无权限", 502) from None
        if exc.code == 429:
            raise VisionError("视觉模型额度或频率受限，稍后再试", 502) from None
        raise VisionError("视觉模型暂时不可用", 502) from None
    except (json.JSONDecodeError, UnicodeDecodeError):
        log.warning("vision caption returned non-json")
        raise VisionError("视觉模型返回格式异常", 502) from None
    except (urllib.error.URLError, TimeoutError, OSError):
        log.warning("vision network failed")
        raise VisionError("视觉模型连接超时", 504) from None

    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise VisionError("视觉模型返回格式异常", 502) from None
    if isinstance(content, list):
        content = "".join(
            str(part.get("text") or "") for part in content if isinstance(part, dict)
        )
    titles = _vision_titles(str(content or ""))
    if not titles:
        log.warning("vision unparseable output")
        raise VisionError("这次没想出合适的标题，再试一次", 502)
    return {
        "titles": titles,
        "provider": "openai-compatible",
        "model": cfg["model"],
        "elapsedMs": int((time.time() - started) * 1000),
    }


def _vision_description(raw: str) -> str:
    """把模型的 JSON / 纯文本输出收成一句 60 字以内的画面描述。"""
    data = parse_json(raw)
    text = ""
    if isinstance(data, dict):
        text = str(data.get("description") or data.get("caption") or "")
    if not text:
        text = str(raw or "")
    text = " ".join(text.replace("”", "").replace("“", "").split())
    text = text.strip("。！？!?；;，, \"'")
    if len(text) > 60:
        text = text[:60].rstrip("，,。 ")
    return text


def describe(image_data_url: str) -> dict:
    """让视觉模型只描述画面，供相册故事理解照片；不猜身份、不抒情。"""
    cfg = vision_config()
    if not cfg["configured"]:
        raise VisionError("视觉模型还没配置", 503)

    image = _prepare_image(image_data_url)
    prompt = (
        "你是家庭相册的记录者。只客观描述这张照片里看得见的内容："
        "宝宝在做什么或什么姿势、衣物或毯子、光线、出现的身体部位或物品。"
        "用一句中文，45 字以内；不猜年龄性别、不判断情绪、不出现姓名地点、"
        "不抒情、不评价长相。只输出 JSON：{\"description\":\"...\"}"
    )
    body = json.dumps(
        {
            "model": cfg["model"],
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": image}},
                    ],
                }
            ],
            "temperature": 0.2,
            "max_tokens": 160,
        }
    ).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Nestory/1.0",
        "Authorization": "Bearer " + os.environ["NESTORY_VISION_KEY"],
    }
    started = time.time()
    req = urllib.request.Request(cfg["base"], data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        log.warning("vision describe http %s", exc.code)
        if exc.code in (401, 403):
            raise VisionError("视觉模型 Key 无效或无权限", 502) from None
        if exc.code == 429:
            raise VisionError("视觉模型额度或频率受限，稍后再试", 502) from None
        raise VisionError("视觉模型暂时不可用", 502) from None
    except (json.JSONDecodeError, UnicodeDecodeError):
        log.warning("vision describe returned non-json")
        raise VisionError("视觉模型返回格式异常", 502) from None
    except (urllib.error.URLError, TimeoutError, OSError):
        log.warning("vision describe network failed")
        raise VisionError("视觉模型连接超时", 504) from None

    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise VisionError("视觉模型返回格式异常", 502) from None
    if isinstance(content, list):
        content = "".join(
            str(part.get("text") or "") for part in content if isinstance(part, dict)
        )
    description = _vision_description(str(content or ""))
    if not description:
        log.warning("vision describe unparseable output")
        raise VisionError("这次没看清照片，再试一次", 502)
    return {
        "description": description,
        "provider": "openai-compatible",
        "model": cfg["model"],
        "elapsedMs": int((time.time() - started) * 1000),
    }


def probe() -> tuple[bool, str, int]:
    """启动时做一次最小调用，确认模型真的可用。"""
    started = time.time()
    try:
        text, provider = complete("请只回复：ok")
        return bool(text and text.strip()), provider, int((time.time() - started) * 1000)
    except (
        OSError,
        ValueError,
        KeyError,
        RuntimeError,
        urllib.error.URLError,
        TimeoutError,
    ) as exc:
        return False, f"{type(exc).__name__}: {exc}", int((time.time() - started) * 1000)

SYSTEM_HINT = (
    "你是一位温柔、克制的家庭记录者，为婴儿成长应用 Nestory 写一句「今日小结」。"
    "像写在相册背面的一句话：抓住今天的一个小画面或小感受，不要罗列数字，"
    "不要夸张、不要排比、不要感叹号。"
)


# --------------------------------------------------------------------------- 统计


def _local_midnight_ms(now_ms: int) -> int:
    today = datetime.fromtimestamp(now_ms / 1000).astimezone()
    start = today.replace(hour=0, minute=0, second=0, microsecond=0)
    return int(start.timestamp() * 1000)


def _int(value, default: int = 0) -> int:
    """客户端 state 只做了浅校验，时间/数字字段可能是字符串或缺失。"""
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _number(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number


def summarize(state: dict, now_ms: int | None = None) -> dict:
    """把 AppState 里今天的记录压成一组可读数字（也给 prompt 用）。"""
    now = now_ms or int(time.time() * 1000)
    start = _local_midnight_ms(now)

    feeds = [
        f for f in state.get("feeds", []) if isinstance(f, dict) and _int(f.get("startedAt")) >= start
    ]
    bottle = sum(_int(f.get("bottleMl")) + _int(f.get("formulaMl")) for f in feeds)
    nurse_min = sum(_int(f.get("leftSec")) + _int(f.get("rightSec")) for f in feeds) // 60

    sleeps = [
        s
        for s in state.get("sleeps", [])
        if isinstance(s, dict) and _int(s.get("startedAt")) + 86400000 >= start
    ]
    sleep_min = 0
    for s in sleeps:
        began = max(_int(s.get("startedAt")), start)
        ended = _int(s.get("endedAt"), now)
        sleep_min += max(0, (min(ended, now) - began) // 60000)

    diapers = [
        d for d in state.get("diapers", []) if isinstance(d, dict) and _int(d.get("at")) >= start
    ]
    diapers_wet = sum(1 for d in diapers if d.get("kind") in ("wet", "both"))
    diapers_dirty = sum(1 for d in diapers if d.get("kind") in ("dirty", "both"))

    growths = sorted(
        [g for g in state.get("growths", []) if isinstance(g, dict)],
        key=lambda g: _int(g.get("at")),
        reverse=True,
    )
    weight = next((_number(g.get("weightKg")) for g in growths if _number(g.get("weightKg"))), None)

    milestones = sorted(
        [m for m in state.get("milestones", []) if isinstance(m, dict)],
        key=lambda m: _int(m.get("at")),
        reverse=True,
    )
    recent = [str(m.get("title")) for m in milestones[:2] if m.get("title")]

    baby = state.get("baby") or {}
    days_old = None
    birthday = str(baby.get("birthday") or "")
    try:
        born = date.fromisoformat(birthday)
        days_old = (datetime.fromtimestamp(now / 1000).astimezone().date() - born).days
    except ValueError:
        born = None

    return {
        "name": str(baby.get("name") or "宝宝"),
        "days_old": days_old,
        "months_old": (days_old // 30) if days_old is not None and days_old >= 0 else None,
        "feed_count": len(feeds),
        "bottle_ml": bottle,
        "nurse_min": nurse_min,
        "sleep_min": sleep_min,
        "sleep_segments": len(sleeps),
        "diaper_wet": diapers_wet,
        "diaper_dirty": diapers_dirty,
        "weight": weight,
        "recent": recent,
        "now": now,
    }


def _age_label(info: dict) -> str:
    if info["days_old"] is None:
        return ""
    months = info["months_old"] or 0
    rest = info["days_old"] - months * 30
    if months <= 0:
        return f"{info['days_old']} 天"
    return f"{months} 个月 {rest} 天"


def _duration(minutes: int) -> str:
    hours, mins = divmod(int(minutes), 60)
    if hours and mins:
        return f"{hours} 小时 {mins} 分"
    if hours:
        return f"{hours} 小时"
    return f"{mins} 分钟"


# --------------------------------------------------------------------------- prompt


def build_prompt(info: dict) -> str:
    """拼成一段短 prompt：要短，因为 GET 长度有限。"""
    facts = []
    if info["feed_count"]:
        detail = []
        if info["bottle_ml"]:
            detail.append(f"瓶喂 {info['bottle_ml']}ml")
        if info["nurse_min"]:
            detail.append(f"亲喂 {info['nurse_min']} 分钟")
        facts.append(f"喂养 {info['feed_count']} 次（{'、'.join(detail) or '已记录'}）")
    if info["sleep_segments"]:
        facts.append(f"睡眠 {info['sleep_segments']} 段共 {_duration(info['sleep_min'])}")
    if info["diaper_wet"] or info["diaper_dirty"]:
        facts.append(
            f"尿布 {info['diaper_wet'] + info['diaper_dirty']} 次"
            f"（湿 {info['diaper_wet']}、脏 {info['diaper_dirty']}）"
        )
    if info["weight"]:
        facts.append(f"最近体重 {info['weight']:.1f}kg")

    lines = [SYSTEM_HINT, f"宝宝：{info['name']}，{_age_label(info)}。"]
    if facts:
        lines.append("今天：" + "；".join(facts) + "。")
    if info["recent"]:
        lines.append("最近的里程碑：" + "、".join(info["recent"]) + "。")
    lines.append(
        "只输出一个 JSON 对象，不要代码块、不要解释、不要多余文字："
        '{"title":"12 字以内，具体一点","note":"50 字以内，温柔克制"}'
    )
    return "\n".join(lines)


# --------------------------------------------------------------------------- 调用


def _post_openai_compatible(prompt: str) -> str:
    base = os.environ["NESTORY_LLM_BASE"]
    body = json.dumps(
        {
            "model": os.environ.get("NESTORY_LLM_MODEL", "gpt-4o-mini"),
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.7,
        }
    ).encode("utf-8")
    headers = {"Content-Type": "application/json", "User-Agent": "Nestory/1.0"}
    if os.environ.get("NESTORY_LLM_KEY"):
        headers["Authorization"] = "Bearer " + os.environ["NESTORY_LLM_KEY"]
    req = urllib.request.Request(base, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise RuntimeError("unexpected chat completion payload") from None
    if isinstance(content, list):  # 部分兼容服务返回 [{type:text,text:...}]
        content = "".join(
            str(part.get("text") or "") for part in content if isinstance(part, dict)
        )
    return str(content or "")


def _get_pollinations(prompt: str, model: str | None = None) -> str:
    model = model or os.environ.get("NESTORY_LLM_MODEL", "openai")
    # 路径里带换行会被网关当成非法路径（404），先压成一行
    flat = re.sub(r"\s+", " ", prompt).strip()
    url = POLLINATIONS + urllib.parse.quote(flat, safe="") + "?model=" + urllib.parse.quote(model)
    req = urllib.request.Request(url, headers={"User-Agent": "Nestory/1.0"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return resp.read().decode("utf-8", "replace")


def _http_detail(exc: urllib.error.HTTPError) -> str:
    try:
        return exc.read().decode("utf-8", "replace")
    except Exception:  # noqa: BLE001 - 读不到 body 不影响主流程
        return ""


def _parse(text: str) -> tuple[str, str] | None:
    data = parse_json(text)
    if not data:
        return None
    title = str(data.get("title") or "").strip().strip('"“”')
    note = str(data.get("note") or "").strip().strip('"“”')
    title = re.sub(r"\s+", " ", title)[:18]
    note = re.sub(r"\s+", " ", note)[:70]
    if not title or not note:
        return None
    return title, note


def parse_json(text: str) -> dict | None:
    """从模型输出里尽量取出一个 JSON 对象；失败返回 None。"""
    raw = (text or "").strip()
    raw = re.sub(r"^```(?:json)?|```$", "", raw, flags=re.M).strip()
    match = re.search(r"\{.*\}", raw, re.S)
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def complete(prompt: str) -> tuple[str, str]:
    """通用补全：返回 (text, provider)。失败交给调用方兜底。"""
    return _call_remote(prompt)


def fallback(info: dict) -> tuple[str, str]:
    """没有网络时也要有一条像样的内容：用今天的数字拼出来。"""
    bits = []
    if info["feed_count"]:
        bits.append(f"喂了 {info['feed_count']} 次奶")
    if info["sleep_segments"]:
        bits.append(f"睡了 {_duration(info['sleep_min'])}")
    if info["diaper_wet"] or info["diaper_dirty"]:
        bits.append(f"换了 {info['diaper_wet'] + info['diaper_dirty']} 次尿布")
    body = "，".join(bits) if bits else "今天还没有记录，慢慢来"
    note = f"{body}。这些细碎的时刻，都算数。"
    return "平常又完整的一天", note[:70]


def _call_remote(prompt: str) -> tuple[str, str]:
    """调远端模型。

    Pollinations 的 ``openai`` 是推理模型，结构化输出偶尔会把 token 花在思考上，
    返回 400 output_token_limit_exceeded；这时自动换 ``openai-fast`` 再试一次。
    402/429/5xx 仍按原策略重试一次。
    """
    base = os.environ.get("NESTORY_LLM_BASE")
    if base:
        return _post_openai_compatible(prompt), "openai-compatible"

    primary = os.environ.get("NESTORY_LLM_MODEL", "openai")
    models = [primary]
    if primary != "openai-fast":
        models.append("openai-fast")

    last: Exception | None = None
    for model in models:
        for attempt in range(2):
            try:
                text = _get_pollinations(prompt, model)
                log.debug("model=%s ok chars=%d", model, len(text))
                return text, "pollinations"
            except urllib.error.HTTPError as exc:
                last = exc
                detail = _http_detail(exc)
                if exc.code == 400 and "output_token_limit" in detail:
                    log.info("model=%s exhausted output tokens, trying next model", model)
                    break
                if exc.code not in (402, 429, 500, 502, 503, 504) or attempt == 1:
                    break
            except (urllib.error.URLError, TimeoutError, OSError, KeyError, ValueError) as exc:
                last = exc
                if attempt == 1:
                    break
            log.warning("model=%s retry %d after %s", model, attempt + 1, type(last).__name__)
            time.sleep(2)
    raise last or RuntimeError("remote call failed")


def generate(state: dict, now_ms: int | None = None) -> dict:
    """返回 {title, note, provider, model, elapsedMs}；失败时 provider 为 local。"""
    info = summarize(state, now_ms)
    prompt = build_prompt(info)
    started = time.time()
    text = ""
    provider = "local"

    try:
        text, provider = _call_remote(prompt)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, KeyError, ValueError) as exc:
        log.warning("remote failed: %s: %s", type(exc).__name__, exc)
        text = ""

    parsed = _parse(text) if text else None
    if parsed is None:
        if text:
            log.warning("unparseable output: %r", text[:160])
        title, note = fallback(info)
        provider = "local"
    else:
        title, note = parsed

    return {
        "title": title,
        "note": note,
        "provider": provider,
        "model": os.environ.get("NESTORY_LLM_MODEL", "openai"),
        "elapsedMs": int((time.time() - started) * 1000),
    }


if __name__ == "__main__":
    demo = {
        "baby": {"name": "小柚", "birthday": (date.today() - timedelta(days=102)).isoformat()},
        "feeds": [
            {"startedAt": int(time.time() * 1000) - 3600_000, "bottleMl": 120, "leftSec": 0, "rightSec": 0},
            {"startedAt": int(time.time() * 1000) - 7200_000, "bottleMl": 0, "leftSec": 840, "rightSec": 0},
        ],
        "sleeps": [{"startedAt": int(time.time() * 1000) - 5400_000, "endedAt": int(time.time() * 1000) - 1800_000}],
        "diapers": [{"at": int(time.time() * 1000) - 600_000, "kind": "wet"}],
        "growths": [{"at": int(time.time() * 1000) - 86400000, "weightKg": 5.6}],
        "milestones": [{"at": int(time.time() * 1000) - 86400000, "title": "第一次翻身"}],
    }
    print(json.dumps(generate(demo), ensure_ascii=False, indent=2))
