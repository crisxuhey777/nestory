#!/usr/bin/env python3
"""AI 成长分析与相册故事。

复用 ``llm`` 里的调用/解析/兜底能力，产出两类内容：

* ``analysis(state)``：近 7 天的喂养、睡眠、尿布、体重与里程碑，给出一句判断、
  三条观察（喂养/睡眠/成长）和两条今天就能试的小建议；
* ``story(state)``：根据相册里的照片标题与里程碑，写一段 2–3 句的相册故事。

两者都是「模型优先、本地兜底」：公网不通或被限流时，用规则拼出结构一致的内容，
前端永远能拿到可渲染的 JSON。
"""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import date, datetime

import llm

log = logging.getLogger("nestory.ai")

DAY_MS = 86_400_000


# --------------------------------------------------------------------------- 工具


def _midnight(ms: int) -> int:
    local = datetime.fromtimestamp(ms / 1000).astimezone()
    return int(local.replace(hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)


def _duration(minutes: int) -> str:
    return llm._duration(minutes)


def _age_text(days: int | None) -> str:
    if days is None:
        return ""
    return llm._age_label({"days_old": days, "months_old": days // 30})


def _hour(ms: int) -> int:
    return datetime.fromtimestamp(ms / 1000).astimezone().hour


# --------------------------------------------------------------------------- 近 7 天


def week_facts(state: dict, now_ms: int | None = None, days: int = 7) -> dict:
    now = now_ms or int(time.time() * 1000)
    start = _midnight(now) - (days - 1) * DAY_MS

    def within(ms: int) -> bool:
        return start <= ms <= now

    feeds = [f for f in state.get("feeds", []) if within(int(f.get("startedAt") or 0))]
    bottle = sum(int(f.get("bottleMl") or 0) + int(f.get("formulaMl") or 0) for f in feeds)
    nurse_min = sum(int(f.get("leftSec") or 0) + int(f.get("rightSec") or 0) for f in feeds) // 60
    feed_days = len(
        {
            datetime.fromtimestamp(int(f["startedAt"]) / 1000).astimezone().date()
            for f in feeds
        }
    )

    sleeps = [s for s in state.get("sleeps", []) if int(s.get("startedAt") or 0) >= start - DAY_MS]
    sleep_min = 0
    night_segments = 0
    counted = 0
    for s in sleeps:
        began = max(int(s.get("startedAt") or 0), start)
        ended = int(s.get("endedAt") or now)
        if ended <= began:
            continue
        sleep_min += max(0, (min(ended, now) - began) // 60000)
        counted += 1
        hour = _hour(int(s.get("startedAt") or 0))
        if hour >= 22 or hour < 6:
            night_segments += 1

    diapers = [d for d in state.get("diapers", []) if within(int(d.get("at") or 0))]
    photos = [p for p in state.get("photos", []) if within(int(p.get("at") or 0))]

    growths = sorted(
        [g for g in state.get("growths", []) if g.get("weightKg")],
        key=lambda g: int(g.get("at") or 0),
    )
    weight_start = float(growths[-2]["weightKg"]) if len(growths) >= 2 else None
    weight_end = float(growths[-1]["weightKg"]) if growths else None
    weight_delta = (weight_end - weight_start) if weight_start is not None else None

    milestones = sorted(
        [m for m in state.get("milestones", []) if within(int(m.get("at") or 0))],
        key=lambda m: int(m.get("at") or 0),
        reverse=True,
    )

    return {
        "days": days,
        "start": start,
        "feeds": len(feeds),
        "feed_days": feed_days,
        "bottle_ml": bottle,
        "nurse_min": nurse_min,
        "sleep_min": sleep_min,
        "sleep_segments": counted,
        "night_segments": night_segments,
        "diapers": len(diapers),
        "photos": len(photos),
        "weight_end": weight_end,
        "weight_delta": weight_delta,
        "milestones": [str(m.get("title")) for m in milestones[:3] if m.get("title")],
    }


def _week_text(week: dict) -> str:
    bits = []
    if week["feeds"]:
        detail = f"喂养 {week['feeds']} 次（{week['feed_days']} 天有记录）"
        if week["bottle_ml"]:
            detail += f"，瓶喂 {week['bottle_ml']}ml"
        if week["nurse_min"]:
            detail += f"，亲喂 {week['nurse_min']} 分钟"
        bits.append(detail)
    if week["sleep_segments"]:
        bits.append(
            f"睡眠 {week['sleep_segments']} 段共 {_duration(week['sleep_min'])}，"
            f"其中夜觉 {week['night_segments']} 段"
        )
    if week["diapers"]:
        bits.append(f"尿布 {week['diapers']} 次")
    if week["weight_delta"] is not None:
        bits.append(f"体重变化 {week['weight_delta']:+.1f}kg（现 {week['weight_end']:.1f}kg）")
    elif week["weight_end"] is not None:
        bits.append(f"最近体重 {week['weight_end']:.1f}kg")
    if week["milestones"]:
        bits.append("里程碑：" + "、".join(week["milestones"]))
    return "；".join(bits) or "这周还没有记录"


# --------------------------------------------------------------------------- 成长分析


def _clean_points(raw) -> list[dict]:
    points = []
    if not isinstance(raw, list):
        return points
    for item in raw[:3]:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").strip()[:6]
        text = str(item.get("text") or "").strip()
        text = " ".join(text.split())[:42]
        if label and text:
            points.append({"label": label, "text": text})
    return points


def _clean_tips(raw) -> list[str]:
    if not isinstance(raw, list):
        return []
    tips = []
    for item in raw[:3]:
        text = " ".join(str(item or "").split())[:46]
        if text:
            tips.append(text)
    return tips


def _fallback_analysis(info: dict, week: dict) -> dict:
    points = []

    if week["feeds"]:
        if week["bottle_ml"] and week["nurse_min"]:
            points.append(
                {
                    "label": "喂养",
                    "text": f"平均每天 {week['feeds'] / 7:.1f} 次，瓶喂 {week['bottle_ml']}ml，亲喂也有记录",
                }
            )
        elif week["bottle_ml"]:
            points.append({"label": "喂养", "text": f"平均每天 {week['feeds'] / 7:.1f} 次，以瓶喂为主"})
        else:
            points.append({"label": "喂养", "text": f"平均每天 {week['feeds'] / 7:.1f} 次，以亲喂为主"})
    else:
        points.append({"label": "喂养", "text": "这周还没有喂养记录"})

    if week["sleep_segments"]:
        points.append(
            {
                "label": "睡眠",
                "text": f"每天约 {_duration(week['sleep_min'] // 7)}，夜觉 {week['night_segments']} 段",
            }
        )
    else:
        points.append({"label": "睡眠", "text": "这周还没有完整的睡眠记录"})

    if week["weight_delta"] is not None:
        points.append({"label": "成长", "text": f"体重比上次 {week['weight_delta']:+.1f}kg，现在 {week['weight_end']:.1f}kg"})
    elif week["milestones"]:
        points.append({"label": "成长", "text": "最近的里程碑：" + "、".join(week["milestones"][:2])})
    else:
        points.append({"label": "成长", "text": "体重记录还没有更新"})

    days = info.get("days_old")
    if days is not None and days < 180:
        tips = ["白天清醒时多趴一会儿，练抬头", "夜里喂奶保持灯光昏暗、少说话"]
    elif days is not None and days < 365:
        tips = ["新食物一次只加一种，观察三天", "睡前固定一套小流程，灯暗下来"]
    else:
        tips = ["每天留十分钟只陪玩，不看手机", "把新词放进日常对话，多说一遍"]

    return {
        "headline": "这一周，节奏在慢慢稳下来",
        "points": points,
        "tips": tips,
    }


def build_analysis_prompt(info: dict, week: dict) -> str:
    lines = [
        "你是一位温和、有经验的婴儿观察者，为成长应用 Nestory 写「近 7 天成长分析」。",
        "语气克制、具体，像儿科医生在门诊小声说话；不夸张、不吓人、不用感叹号。",
        f"宝宝：{info['name']}，{_age_text(info.get('days_old'))}。",
        f"近 7 天事实：{_week_text(week)}。",
        "只输出 JSON，不要代码块：",
        '{"headline":"16 字以内","points":['
        '{"label":"喂养","text":"26 字以内，说趋势不是报数字"},'
        '{"label":"睡眠","text":"26 字以内"},'
        '{"label":"成长","text":"26 字以内"}'
        '],"tips":["今天可以试的小建议，18 字以内","另一条，18 字以内"]}',
    ]
    return "\n".join(lines)


def analysis(state: dict, now_ms: int | None = None) -> dict:
    now = now_ms or int(time.time() * 1000)
    info = llm.summarize(state, now)
    week = week_facts(state, now)
    started = time.time()
    provider = "local"
    text = ""

    try:
        text, provider = llm.complete(build_analysis_prompt(info, week))
    except (OSError, ValueError, KeyError, TimeoutError) as exc:
        log.warning("[analysis] remote failed: %s: %s", type(exc).__name__, exc)

    data = llm.parse_json(text) if text else None
    cleaned = None
    if data:
        headline = " ".join(str(data.get("headline") or "").split())[:30]
        points = _clean_points(data.get("points"))
        tips = _clean_tips(data.get("tips"))
        if headline and len(points) >= 2 and tips:
            cleaned = {"headline": headline, "points": points, "tips": tips}

    if cleaned is None:
        if text:
            log.warning("[analysis] unparseable output: %r", text[:160])
        cleaned = _fallback_analysis(info, week)
        provider = "local"

    return {
        "analysis": cleaned,
        "provider": provider,
        "model": os.environ.get("NESTORY_LLM_MODEL", "openai"),
        "elapsedMs": int((time.time() - started) * 1000),
    }


# --------------------------------------------------------------------------- 相册故事


def album_facts(state: dict, now_ms: int | None = None) -> dict:
    now = now_ms or int(time.time() * 1000)
    baby = state.get("baby") or {}
    photos = sorted(state.get("photos", []), key=lambda p: int(p.get("at") or 0), reverse=True)

    born = None
    try:
        born = date.fromisoformat(str(baby.get("birthday") or ""))
    except ValueError:
        pass

    span = ""
    if photos:
        first = datetime.fromtimestamp(int(photos[-1]["at"]) / 1000).astimezone()
        last = datetime.fromtimestamp(int(photos[0]["at"]) / 1000).astimezone()
        span = f"{first.month} 月 {first.day} 日 到 {last.month} 月 {last.day} 日"

    milestones = sorted(
        [m for m in state.get("milestones", []) if m.get("title")],
        key=lambda m: int(m.get("at") or 0),
        reverse=True,
    )

    return {
        "name": str(baby.get("name") or "宝宝"),
        "days_old": (datetime.fromtimestamp(now / 1000).astimezone().date() - born).days if born else None,
        "count": len(photos),
        "span": span,
        "captions": [str(p.get("caption")) for p in photos[:5] if p.get("caption")],
        "milestones": [str(m.get("title")) for m in milestones[:3]],
    }


def _fallback_story(facts: dict) -> dict:
    name = facts["name"]
    if facts["count"] == 0:
        return {"title": "第一张还没来", "body": f"{name} 的相册还空着。等第一个瞬间落进来，这里就会开始讲故事。"}
    captions = "、".join(facts["captions"][:3])
    body = f"{name}的相册里已经收着 {facts['count']} 个瞬间"
    if facts["span"]:
        body += f"，从 {facts['span']}"
    body += "。"
    if captions:
        body += f"有{captions}，也有那些没来得及命名的日常。"
    if facts["milestones"]:
        body += "这些日子连起来，就是长大。"
    return {"title": "把日子收进一册", "body": body[:120]}


def build_story_prompt(facts: dict) -> str:
    lines = [
        "你是家庭相册的编辑，为 Nestory 写一段 2–3 句的「相册故事」。",
        "温柔、具体、克制；不要罗列数字，不要夸张，不要感叹号。",
        f"宝宝：{facts['name']}，{_age_text(facts.get('days_old'))}。",
        f"相册：{facts['count']} 张，跨度 {facts['span'] or '还没有照片'}。",
    ]
    if facts["captions"]:
        lines.append("照片标题：" + "、".join(facts["captions"]) + "。")
    if facts["milestones"]:
        lines.append("里程碑：" + "、".join(facts["milestones"]) + "。")
    lines.append(
        '只输出 JSON，不要代码块：{"title":"12 字以内","body":"80 字以内，2 到 3 句"}'
    )
    lines.append("只使用上面给出的事实，不要编造照片里没有的细节，也不要写宝宝做不到的动作；不要虚构衣物、对白或天气。")
    return "\n".join(lines)


def story(state: dict, now_ms: int | None = None) -> dict:
    now = now_ms or int(time.time() * 1000)
    facts = album_facts(state, now)
    started = time.time()
    provider = "local"
    text = ""

    try:
        text, provider = llm.complete(build_story_prompt(facts))
    except (OSError, ValueError, KeyError, TimeoutError) as exc:
        log.warning("[story] remote failed: %s: %s", type(exc).__name__, exc)

    data = llm.parse_json(text) if text else None
    cleaned = None
    if data:
        title = " ".join(str(data.get("title") or "").split())[:16]
        body = " ".join(str(data.get("body") or "").split())[:120]
        if title and body:
            cleaned = {"title": title, "body": body}

    if cleaned is None:
        if text:
            log.warning("[story] unparseable output: %r", text[:160])
        cleaned = _fallback_story(facts)
        provider = "local"

    return {
        "story": cleaned,
        "provider": provider,
        "model": os.environ.get("NESTORY_LLM_MODEL", "openai"),
        "elapsedMs": int((time.time() - started) * 1000),
    }


if __name__ == "__main__":
    demo = {
        "baby": {"name": "小柚", "birthday": (date.today().replace(day=1)).isoformat()},
        "feeds": [{"startedAt": int(time.time() * 1000) - i * 3600_000, "bottleMl": 120} for i in range(1, 9)],
        "sleeps": [{"startedAt": int(time.time() * 1000) - i * 7200_000, "endedAt": int(time.time() * 1000) - i * 7200_000 + 3600_000} for i in range(1, 6)],
        "diapers": [{"at": int(time.time() * 1000) - i * 3600_000, "kind": "wet"} for i in range(1, 6)],
        "growths": [{"at": int(time.time() * 1000) - 86400000, "weightKg": 5.4}, {"at": int(time.time() * 1000), "weightKg": 5.6}],
        "milestones": [{"at": int(time.time() * 1000) - 86400000, "title": "第一次翻身"}],
        "photos": [{"at": int(time.time() * 1000) - 3600_000, "caption": "午睡"}],
    }
    print(json.dumps({"analysis": analysis(demo)}, ensure_ascii=False, indent=2))
