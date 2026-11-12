"""Nestory · 本地演示数据（后端侧）

与前端 ``src/data/test_config.js`` 一一对应：这里只放「数据」，不含任何业务逻辑。
正式版本中这些内容都会来自数据库；在当前阶段（无数据库），它们是唯一的种子数据。

约定：
- 时间字符串一律按服务器本地时区解析（与浏览器同一时区时结果完全一致）。
- ``minutesAgo`` / ``dayOffset`` 等相对时间由 ``app_state.py`` 在每次请求时换算成 epoch ms，
  因此页面上的「20 分钟前喂过奶」永远是相对当下的，不会随着日期推移变成历史。
"""

TEST_HERO_IDS = ["ph1", "ph3", "ph4", "ph2"]

TEST_AVATARS = [
    "/assets/photos/p1@520.jpg",
    "/assets/photos/p2@520.jpg",
    "/assets/photos/p3@520.jpg",
    "/assets/photos/p4@520.jpg",
]

TEST_BABY = {
    "name": "小柚",
    "birthday": "2026-07-31",
    "birthTime": "06:20",
    "gender": "girl",
    "birthWeightKg": 3.2,
    "birthHeightCm": 50,
    "birthHeadCm": 34,
    "birthplace": "杭州",
    "avatar": "/assets/photos/p1@520.jpg",
}

TEST_FAMILY = [
    {"id": "u1", "name": "妈妈", "role": "家庭管理员", "color": "#B8C3B1", "permission": "admin"},
    {"id": "u2", "name": "爸爸", "role": "可编辑", "color": "#D7C6A4", "permission": "edit"},
    {"id": "u3", "name": "外婆", "role": "只读", "color": "#C9D3C4", "permission": "read"},
    {"id": "u4", "name": "奶奶", "role": "只读", "color": "#E3D8C4", "permission": "read"},
]

# 当前设备登录的家庭成员；正式后端应由会话/鉴权返回。
TEST_VIEWER_ID = "u1"

# 相册：at 是本地时间字符串，app_state 会解析成时间戳。
TEST_PHOTOS = [
    {
        "id": "ph5",
        "src": "/assets/photos/live-poster.jpg",
        "thumb": "/assets/photos/live-poster.jpg",
        "at": "2026-11-11 15:40",
        "caption": "睡着时的小呼吸",
        "author": "妈妈",
        "kind": "live",
        "video": "/assets/videos/nest-live.mp4",
        "durationSec": 3.5,
    },
    {
        "id": "ph6",
        "src": "/assets/photos/video-poster.jpg",
        "thumb": "/assets/photos/video-poster.jpg",
        "at": "2026-11-09 16:10",
        "caption": "手指轻轻动了一下",
        "author": "爸爸",
        "kind": "video",
        "video": "/assets/videos/nest-video.mp4",
        "durationSec": 3.2,
    },
    {
        "id": "ph1",
        "src": "/assets/photos/p1@1200.jpg",
        "thumb": "/assets/photos/p1@520.jpg",
        "at": "2026-11-06 09:20",
        "caption": "在巢里睡着的样子",
        "author": "妈妈",
    },
    {
        "id": "ph2",
        "src": "/assets/photos/p3@1200.jpg",
        "thumb": "/assets/photos/p3@520.jpg",
        "at": "2026-07-31 15:10",
        "caption": "满月，握住了爸爸的手",
        "author": "爸爸",
    },
    {
        "id": "ph3",
        "src": "/assets/photos/p4@1200.jpg",
        "thumb": "/assets/photos/p4@520.jpg",
        "at": "2026-11-10 14:05",
        "caption": "午后的小睡",
        "author": "妈妈",
    },
    {
        "id": "ph4",
        "src": "/assets/photos/p2@1200.jpg",
        "thumb": "/assets/photos/p2@520.jpg",
        "at": "2026-11-08 10:40",
        "caption": "小袜子终于合脚了",
        "author": "外婆",
    },
]

# 近 6 天的历史喂养模板。
# fromDaysAgo / toDaysAgo 生成区间；atHour 是当天的小时（可带小数）。
TEST_FEED_HISTORY = {
    "fromDaysAgo": 1,
    "toDaysAgo": 6,
    "meals": [
        {"atHour": 2.4, "bottleMl": 110},
        {"atHour": 6.9, "leftSec": 12 * 60, "rightSec": 8 * 60},
        {"atHour": 11.2, "formulaMl": 90},
        {"atHour": 15.7, "bottleMl": 120},
        {"atHour": 19.5, "leftSec": 9 * 60, "rightSec": 7 * 60},
        {"atHour": 22.3, "formulaMl": 60},
    ],
    # 第 3 天少一顿，让趋势图有真实波动
    "skip": {"daysAgo": 3, "index": 2},
    "authors": ["妈妈", "爸爸", "外婆"],
}

# 今天与昨天附近的喂养；minutesAgo 相对当前时间，minutesBeforeMidnight 用于跨午夜样本。
TEST_FEEDS_RECENT = [
    {"id": "f0", "minutesBeforeMidnight": 40, "leftSec": 8 * 60, "rightSec": 6 * 60, "author": "爸爸"},
    {"id": "f1", "minutesAgo": 20.5 * 60, "leftSec": 12 * 60, "rightSec": 9 * 60, "author": "妈妈"},
    {"id": "f2", "minutesAgo": 16.2 * 60, "bottleMl": 120, "author": "爸爸"},
    {"id": "f3", "minutesAgo": 12.9 * 60, "leftSec": 7 * 60, "rightSec": 7 * 60, "formulaMl": 60, "author": "妈妈"},
    {"id": "f4", "minutesAgo": 9.6 * 60, "bottleMl": 110, "author": "外婆"},
    {"id": "f5", "minutesAgo": 6.4 * 60, "formulaMl": 90, "author": "妈妈"},
    {
        "id": "f6",
        "minutesAgo": 3.6 * 60,
        "leftSec": 10 * 60,
        "rightSec": 6 * 60,
        "author": "妈妈",
        "note": "今天状态很好，吃完就睡着了",
    },
    {"id": "f7", "minutesAgo": 0.6 * 60, "bottleMl": 100, "author": "爸爸"},
]

TEST_SLEEPS = [
    {"id": "s1", "dayOffset": -1, "startMinutes": 22 * 60 + 40, "durationMinutes": 7.5 * 60},
    {"id": "s2", "dayOffset": 0, "startMinutes": 8 * 60 + 20, "durationMinutes": 70},
    {"id": "s3", "dayOffset": 0, "startMinutes": 11 * 60 + 10, "durationMinutes": 55},
    {"id": "s4", "dayOffset": 0, "startMinutes": 14 * 60 + 30, "durationMinutes": 50},
]

TEST_DIAPERS = [
    {"id": "d1", "dayOffset": 0, "atMinutes": 7 * 60 + 10, "kind": "wet"},
    {"id": "d2", "dayOffset": 0, "atMinutes": 9 * 60 + 40, "kind": "dirty", "note": "金黄色糊状"},
    {"id": "d3", "dayOffset": 0, "atMinutes": 12 * 60 + 15, "kind": "wet"},
    {"id": "d4", "dayOffset": 0, "atMinutes": 14 * 60 + 50, "kind": "both"},
    {"id": "d5", "dayOffset": 0, "atMinutes": 17 * 60 + 5, "kind": "wet"},
    {"id": "d6", "dayOffset": 0, "atMinutes": 19 * 60 + 30, "kind": "wet"},
]

TEST_GROWTHS = [
    {"id": "g1", "at": "2026-07-31", "weightKg": 3.2, "heightCm": 50, "headCm": 34},
    {"id": "g2", "at": "2026-08-31", "weightKg": 4.1, "heightCm": 54, "headCm": 36.5},
    {"id": "g3", "at": "2026-10-02", "weightKg": 5.0, "heightCm": 58, "headCm": 38.5},
    {"id": "g4", "minutesAgoDays": 5, "weightKg": 5.6, "heightCm": 60.5, "headCm": 39.5},
]

TEST_MILESTONES = [
    {
        "id": "m1",
        "at": "2026-07-31 06:20",
        "title": "来到我们身边",
        "note": "3.2 kg · 50 cm · 06:20",
        "kind": "milestone",
    },
    {"id": "m2", "at": "2026-09-20", "title": "第一次抬头", "kind": "milestone"},
    {
        "id": "m3",
        "at": "2026-11-08",
        "title": "第一次翻身",
        "note": "从右边翻过去，自己都愣了一下",
        "kind": "milestone",
    },
]

TEST_REMINDER = {
    "enabled": True,
    "intervalMinutes": 180,
    "quietNight": True,
    "vibration": True,
}

TEST_LAST_SYNCED_MINUTES = 4


def as_dict() -> dict:
    """调试用：把原始模板原样导出（时间仍是模板里的字符串）。"""
    return {
        "heroPhotoIds": TEST_HERO_IDS,
        "avatars": TEST_AVATARS,
        "baby": TEST_BABY,
        "family": TEST_FAMILY,
        "photos": TEST_PHOTOS,
        "feedHistory": TEST_FEED_HISTORY,
        "feedsRecent": TEST_FEEDS_RECENT,
        "sleeps": TEST_SLEEPS,
        "diapers": TEST_DIAPERS,
        "growths": TEST_GROWTHS,
        "milestones": TEST_MILESTONES,
        "reminder": TEST_REMINDER,
        "lastSyncedMinutes": TEST_LAST_SYNCED_MINUTES,
    }
