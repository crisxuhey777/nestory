"""把 ``fixtures`` 里的模板换算成前端 ``AppState``（v3）。

这是前端 ``src/data/seed.ts`` 的 Python 版本，逐条对齐：
- 所有时间字段都输出 epoch 毫秒（前端 types.ts 的约定）；
- 相对时间（minutesAgo / dayOffset）在每次请求时基于「当下」重新计算，
  所以夜间喂奶是「20 分钟前」，而不是写死的某个时刻；
- 输出结构与 ``AppState`` 完全一致，前端可以直接 hydrate。
"""

import time
from datetime import datetime

import fixtures as f

M = 60_000
DAY = 86_400_000


# ---------------------------------------------------------------- 时间换算


def local_time(value: str) -> int:
    """``"2026-11-11 15:40"`` / ``"2026-07-31"`` → 本地时区的 epoch 毫秒。"""
    return int(datetime.fromisoformat(value).timestamp() * 1000)


def start_of_day(ms: int) -> int:
    dt = datetime.fromtimestamp(ms / 1000)
    return int(dt.replace(hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)


# ---------------------------------------------------------------- 记录构造


def _feed(record_id: str, at: int, **extra) -> dict:
    record = {
        "id": record_id,
        "startedAt": at,
        "endedAt": at + 18 * M,
        "leftSec": 0,
        "rightSec": 0,
        "bottleMl": 0,
        "formulaMl": 0,
        "author": "妈妈",
        "updatedAt": at,
    }
    record.update({key: value for key, value in extra.items() if value is not None})
    return record


def _pick(source: dict, *keys):
    return {key: source[key] for key in keys if key in source}


def build_state(now_ms: int | None = None) -> dict:
    now = int(time.time() * 1000) if now_ms is None else int(now_ms)
    today = start_of_day(now)

    # ---- 近 6 天历史喂养：让统计与趋势有真实的形状
    history = []
    for days_ago in range(f.TEST_FEED_HISTORY["fromDaysAgo"], f.TEST_FEED_HISTORY["toDaysAgo"] + 1):
        day = today - days_ago * DAY
        plan = [dict(meal) for meal in f.TEST_FEED_HISTORY["meals"]]
        skip = f.TEST_FEED_HISTORY["skip"]
        if days_ago == skip["daysAgo"]:
            plan.pop(skip["index"])
        for index, meal in enumerate(plan):
            history.append(
                _feed(
                    f"h{days_ago}-{index}",
                    day + int(meal["atHour"] * 3_600_000),
                    leftSec=meal.get("leftSec", 0),
                    rightSec=meal.get("rightSec", 0),
                    bottleMl=meal.get("bottleMl", 0),
                    formulaMl=meal.get("formulaMl", 0),
                    author=f.TEST_FEED_HISTORY["authors"][index % len(f.TEST_FEED_HISTORY["authors"])],
                )
            )

    # ---- 今天 / 昨天附近的喂养
    recent_feeds = []
    for item in f.TEST_FEEDS_RECENT:
        if "minutesBeforeMidnight" in item:
            at = today - item["minutesBeforeMidnight"] * M
        else:
            at = now - item.get("minutesAgo", 0) * M
        recent_feeds.append(
            _feed(
                item["id"],
                int(at),
                leftSec=item.get("leftSec", 0),
                rightSec=item.get("rightSec", 0),
                bottleMl=item.get("bottleMl", 0),
                formulaMl=item.get("formulaMl", 0),
                author=item["author"],
                note=item.get("note"),
            )
        )

    # ---- 睡眠
    sleeps = []
    for item in f.TEST_SLEEPS:
        started_at = today + item["dayOffset"] * DAY + item["startMinutes"] * M
        sleeps.append(
            {
                "id": item["id"],
                "startedAt": started_at,
                "endedAt": started_at + item["durationMinutes"] * M,
            }
        )

    # ---- 尿布
    diapers = [
        {
            "id": item["id"],
            "at": today + item["dayOffset"] * DAY + item["atMinutes"] * M,
            "kind": item["kind"],
            **_pick(item, "note"),
        }
        for item in f.TEST_DIAPERS
    ]

    # ---- 生长
    growths = []
    for item in f.TEST_GROWTHS:
        at = local_time(item["at"]) if item.get("at") else now - item.get("minutesAgoDays", 0) * DAY
        growths.append({"id": item["id"], "at": at, **_pick(item, "weightKg", "heightCm", "headCm")})

    # ---- 里程碑
    milestones = [
        {
            "id": item["id"],
            "at": local_time(item["at"]),
            "title": item["title"],
            "kind": item["kind"],
            **_pick(item, "note"),
        }
        for item in f.TEST_MILESTONES
    ]

    # ---- 相册
    photos = []
    for item in f.TEST_PHOTOS:
        photos.append(
            {
                "id": item["id"],
                "src": item["src"],
                "thumb": item["thumb"],
                "at": local_time(item["at"]),
                "caption": item["caption"],
                "author": item["author"],
                **_pick(item, "kind", "video", "durationSec"),
            }
        )

    return {
        "version": 3,
        "baby": dict(f.TEST_BABY),
        "feeds": history + recent_feeds,
        "sleeps": sleeps,
        "diapers": diapers,
        "growths": growths,
        "milestones": milestones,
        "photos": photos,
        "heroPhotoIds": list(f.TEST_HERO_IDS),
        "reminder": dict(f.TEST_REMINDER),
        "family": [dict(member) for member in f.TEST_FAMILY],
        "viewerId": f.TEST_VIEWER_ID,
        "lastSyncedAt": now - f.TEST_LAST_SYNCED_MINUTES * M,
    }


if __name__ == "__main__":
    import json
    import sys

    # Windows 控制台默认编码可能不是 UTF-8，避免打印中文时 UnicodeEncodeError
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")

    state = build_state()
    print(json.dumps(state, ensure_ascii=False, indent=2))
    print(
        f"feeds={len(state['feeds'])} sleeps={len(state['sleeps'])} "
        f"diapers={len(state['diapers'])} photos={len(state['photos'])}",
        flush=True,
    )
