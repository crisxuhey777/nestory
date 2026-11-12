#!/usr/bin/env python3
"""首页每日一句（AI 生成 + 本地兜底）。

规则：

* 一天一句，按「宝宝 + 日期」缓存，同一天刷新不会重复调用模型；
* 优先处理宝宝自己的日子（生日、满月、百天、半岁），再处理公历/农历节日；
* 模型失败或返回不可用时，用本地文案池按日期稳定挑一句，保证首页永远有字。
"""

from __future__ import annotations

import calendar
import hashlib
import json
import logging
import os
import time
from datetime import date, datetime

import llm

log = logging.getLogger("nestory.ai")

# 农历节日换算成公历（2025–2030，够这一版用；过期后自然退回普通日子）
LUNAR_FESTIVALS: dict[tuple[int, int, int], str] = {
    (2025, 1, 29): "春节",
    (2025, 10, 6): "中秋节",
    (2026, 2, 17): "春节",
    (2026, 9, 25): "中秋节",
    (2027, 2, 6): "春节",
    (2027, 9, 15): "中秋节",
    (2028, 1, 26): "春节",
    (2028, 10, 3): "中秋节",
    (2029, 2, 13): "春节",
    (2029, 9, 22): "中秋节",
    (2030, 2, 3): "春节",
    (2030, 9, 12): "中秋节",
}

SOLAR_FESTIVALS: dict[tuple[int, int], str] = {
    (1, 1): "元旦",
    (5, 1): "劳动节",
    (6, 1): "儿童节",
    (10, 1): "国庆节",
    (12, 25): "圣诞节",
}

GENERAL_QUOTES = [
    "不着急，我们有一整个童年，慢慢来。",
    "今天也慢慢来，把日子过成小小的。",
    "好好吃饭，好好睡觉，好好长大。",
    "你在长大，我们在学做爸爸妈妈。",
    "有些日子不用记住，抱着你就够了。",
    "今天的光很软，适合多睡一会儿。",
    "长大是一件很慢的事，我们不赶时间。",
    "把今天收进相册，等你长大再看。",
    "你负责长大，我们负责记得。",
    "一天一天，就是童年。",
    "窗外很安静，你睡着的时候也是。",
    "不用做什么，陪着你就很好。",
]

OCCASION_QUOTES: dict[str, list[str]] = {
    "birthday": [
        "生日快乐，我的小孩。愿你一直被温柔对待。",
        "又长大一岁，慢慢来，我们都在。",
        "谢谢你来我们家，生日快乐。",
        "今天是你来到世界的第几个年头，抱一下。",
    ],
    "full_moon": [
        "满月了，从那么小一只，到现在会皱眉。",
        "第三十天，还是想把你抱紧一点。",
    ],
    "hundred_days": [
        "一百天，从那么小一只，到现在会笑。",
        "第一百天，日子开始有了你的形状。",
        "一百个日夜，你长成了我们的小月亮。",
    ],
    "half_year": [
        "半岁啦，接下来的日子也请多关照。",
        "半年的奶香和夜灯，都算数。",
    ],
    "festival": [
        "节日快乐，今天可以多抱一会儿。",
        "把节日过成普通的一天，也很好。",
    ],
}

FESTIVAL_QUOTES: dict[str, list[str]] = {
    "春节": ["新年好，愿你岁岁平安。", "过年了，家里多了一个小人儿。"],
    "中秋节": ["中秋快乐，月亮和你都很圆。", "今晚的月亮，替我们收着团圆。"],
    "儿童节": ["儿童节快乐，今天可以多玩一会儿。", "今天是你的节日，慢慢长大就好。"],
    "圣诞节": ["圣诞快乐，袜子里装的是糖。", "冬天的第一份礼物，是你。"],
    "元旦": ["新年好，今年也一起慢慢长大。", "新的一年，还是这几件小事。"],
    "国庆节": ["假期很长，刚好用来陪你。", "人多的地方不去，就在家抱你。"],
    "母亲节": ["母亲节，替宝宝说一句：妈妈辛苦了。", "今天让妈妈多睡一会儿。"],
    "父亲节": ["父亲节，替宝宝说一句：爸爸辛苦了。", "今天让爸爸多抱一会儿。"],
}

_CACHE: dict[str, dict] = {}


# --------------------------------------------------------------------------- 日期


def _add_months(day: date, months: int) -> date:
    month = day.month - 1 + months
    year = day.year + month // 12
    month = month % 12 + 1
    last = calendar.monthrange(year, month)[1]
    return date(year, month, min(day.day, last))


def _mothers_day(year: int) -> date:
    # 五月第二个星期日
    first = date(year, 5, 1)
    offset = (6 - first.weekday()) % 7
    return date(year, 5, 1 + offset + 7)


def _fathers_day(year: int) -> date:
    # 六月第三个星期日
    first = date(year, 6, 1)
    offset = (6 - first.weekday()) % 7
    return date(year, 6, 1 + offset + 14)


def _festival(today: date) -> str | None:
    name = SOLAR_FESTIVALS.get((today.month, today.day))
    if name:
        return name
    name = LUNAR_FESTIVALS.get((today.year, today.month, today.day))
    if name:
        return name
    if today == _mothers_day(today.year):
        return "母亲节"
    if today == _fathers_day(today.year):
        return "父亲节"
    return None


def _occasion(baby: dict, today: date) -> dict | None:
    """返回 {kind, label}；没有特别的日子就是 None。"""
    raw = str(baby.get("birthday") or "")
    try:
        born = date.fromisoformat(raw)
    except ValueError:
        born = None

    name = str(baby.get("name") or "宝宝")
    days_old = (today - born).days if born else None

    if born and (today.month, today.day) == (born.month, born.day):
        years = today.year - born.year
        if years == 1:
            return {"kind": "birthday", "label": f"今天是{name}的一周岁生日"}
        if years >= 2:
            return {"kind": "birthday", "label": f"今天是{name}的 {years} 岁生日"}

    if days_old is not None:
        if days_old == 30:
            return {"kind": "full_moon", "label": f"{name}满月了"}
        if days_old == 100:
            return {"kind": "hundred_days", "label": f"{name}来到世界第 100 天"}
        if born and _add_months(born, 6) == today:
            return {"kind": "half_year", "label": f"{name}半岁了"}

    fest = _festival(today)
    if fest:
        return {"kind": "festival", "label": f"今天是{fest}", "name": fest}

    return None


# --------------------------------------------------------------------------- prompt


def _age_text(days: int | None) -> str:
    if days is None:
        return "年龄未知"
    return llm._age_label({"days_old": days, "months_old": days // 30})


DAY_MS = 86400000


def _local_date(ms) -> date | None:
    try:
        return datetime.fromtimestamp(int(ms) / 1000).date()
    except (TypeError, ValueError, OSError):
        return None


def _day_facts(state: dict, today: date) -> str:
    feeds = [f for f in state.get("feeds") or [] if _local_date(f.get("startedAt")) == today]
    sleeps = [s for s in state.get("sleeps") or [] if _local_date(s.get("startedAt")) == today]
    diapers = [d for d in state.get("diapers") or [] if _local_date(d.get("at")) == today]

    minutes = 0
    for s in sleeps:
        began = int(s.get("startedAt") or 0)
        ended = int(s.get("endedAt") or 0)
        if ended > began:
            minutes += (ended - began) // 60000

    parts: list[str] = []
    if feeds:
        parts.append(f"喂奶 {len(feeds)} 次")
    if sleeps:
        parts.append(f"睡眠 {len(sleeps)} 段、共 {minutes // 60} 小时 {minutes % 60} 分")
    if diapers:
        parts.append(f"换尿布 {len(diapers)} 次")

    return "今天已经记录：" + "、".join(parts) + "。" if parts else "今天还没有记录。"


def build_prompt(baby: dict, today: date, occasion: dict | None, facts: str = "") -> str:
    name = str(baby.get("name") or "宝宝")
    days_old = None
    try:
        days_old = (today - date.fromisoformat(str(baby.get("birthday") or ""))).days
    except ValueError:
        pass

    lines = [
        "你是 Nestory 家庭相册的文案，为首页写一句「今天」的话。",
        "语气温柔、克制、具体，像写在相册背面的一句话；不要感叹号、不要引号、不要 emoji。",
        f"宝宝：{name}，{_age_text(days_old)}。",
        f"今天：{today.year} 年 {today.month} 月 {today.day} 日，星期{'一二三四五六日'[today.weekday()]}。",
    ]
    if occasion:
        lines.append(
            f"特别的日子：{occasion['label']}。这句话上方会单独显示这行标签，"
            "句子里不要再重复天数、生日或节日名称，直接写祝福或一个画面。"
        )
    if facts:
        lines.append(facts)
    lines.extend(
        [
            "要求：一句中文，22 字以内；从今天的事实里挑一个细节来写，不要出现数字，"
            "不要新增记录里没有的动作、衣物、天气或对白。",
            "细节优先写：睡着的呼吸、喂奶后的安静、被抱着的重量、刚醒来的表情；"
            "不要写尿布、大小便这类细节，也不要写成流水账。",
            '只输出 JSON，不要代码块：{"text":"这句话"}',
        ]
    )
    return "\n".join(lines)


# --------------------------------------------------------------------------- 兜底


def _fallback(occasion: dict | None, key: str) -> dict:
    kind = occasion["kind"] if occasion else "general"
    if kind == "festival" and occasion and occasion.get("name"):
        pool = FESTIVAL_QUOTES.get(occasion["name"])
    else:
        pool = OCCASION_QUOTES.get(kind) if kind != "general" else None
    pool = pool or GENERAL_QUOTES
    index = int(hashlib.sha1(key.encode("utf-8")).hexdigest(), 16) % len(pool)
    return {
        "text": pool[index],
        "occasion": occasion["kind"] if occasion else None,
        "label": occasion["label"] if occasion else None,
    }


def _clean(text: str) -> str:
    text = " ".join(str(text or "").split())
    text = text.strip("“”\"'「」")
    return text[:40]


# --------------------------------------------------------------------------- 主入口


def daily(state: dict, now_ms: int | None = None) -> dict:
    now = now_ms or int(time.time() * 1000)
    today = datetime.fromtimestamp(now / 1000).astimezone().date()
    baby = state.get("baby") or {}
    key = f"{baby.get('id') or baby.get('name')}:{today.isoformat()}"

    hit = _CACHE.get(key)
    if hit and hit["expires"] > time.time():
        return {**hit["value"], "cached": True}

    occasion = _occasion(baby, today)
    started = time.time()
    provider = "local"
    text = ""

    try:
        text, provider = llm.complete(build_prompt(baby, today, occasion, _day_facts(state, today)))
    except (OSError, ValueError, KeyError, TimeoutError) as exc:
        log.warning("[quote] remote failed: %s: %s", type(exc).__name__, exc)

    quote = None
    data = llm.parse_json(text) if text else None
    if isinstance(data, dict):
        cleaned = _clean(data.get("text"))
        if 4 <= len(cleaned) <= 40:
            quote = {
                "text": cleaned,
                "occasion": occasion["kind"] if occasion else None,
                "label": occasion["label"] if occasion else None,
            }

    if quote is None:
        if text:
            log.warning("[quote] unparseable output: %r", text[:120])
        quote = _fallback(occasion, key)
        provider = "local"

    value = {
        "date": today.isoformat(),
        "quote": quote,
        "provider": provider,
        "model": os.environ.get("NESTORY_LLM_MODEL", "openai"),
        "elapsedMs": int((time.time() - started) * 1000),
    }
    _CACHE[key] = {
        "value": value,
        "expires": now / 1000 + (600 if provider == "local" else 86_400),
    }
    return {**value, "cached": False}


if __name__ == "__main__":
    import sys

    sys.stdout.reconfigure(encoding="utf-8")
    demo = {"baby": {"name": "小柚", "birthday": "2026-07-31", "id": "baby_demo"}}
    print(json.dumps(daily(demo), ensure_ascii=False, indent=2))
