"""加入家庭时的记录合并（family.merge_states）回归测试。

只测纯函数，不连数据库：`python -m unittest discover -s backend/tests -t backend`
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import family  # noqa: E402


def _feed(fid: str, started_at: int, note: str = "") -> dict:
    return {"id": fid, "startedAt": started_at, "note": note, "author": "我"}


def _empty_state() -> dict:
    return {
        "version": 3,
        "baby": {"name": "小满", "birthday": "2024-05-01"},
        "feeds": [],
        "sleeps": [],
        "diapers": [],
        "growths": [],
        "milestones": [],
        "photos": [],
        "heroPhotoIds": [],
        "reminder": {"enabled": True},
    }


class MergeStatesTest(unittest.TestCase):
    def test_target_without_state_adopts_incoming(self) -> None:
        incoming = _empty_state()
        incoming["feeds"] = [_feed("f1", 100), _feed("f2", 200)]
        incoming["baby"] = {"name": "朵朵", "birthday": "2024-01-01"}

        merged, counts = family.merge_states(None, incoming)

        self.assertEqual([item["id"] for item in merged["feeds"]], ["f2", "f1"])
        self.assertEqual(counts, {"feeds": 2})
        self.assertEqual(merged["baby"]["name"], "朵朵")

    def test_records_are_unioned_by_id_and_sorted(self) -> None:
        target = _empty_state()
        target["feeds"] = [_feed("f1", 100), _feed("f3", 300)]
        incoming = _empty_state()
        incoming["feeds"] = [_feed("f1", 100), _feed("f2", 200)]

        merged, counts = family.merge_states(target, incoming)

        self.assertEqual([item["id"] for item in merged["feeds"]], ["f3", "f2", "f1"])
        self.assertEqual(counts, {"feeds": 1})

    def test_baby_profile_and_reminder_keep_target(self) -> None:
        target = _empty_state()
        target["baby"] = {"name": "本家宝宝", "birthday": "2023-03-03"}
        incoming = _empty_state()
        incoming["baby"] = {"name": "加入者宝宝", "birthday": "2024-01-01"}
        incoming["reminder"] = {"enabled": False}
        incoming["feeds"] = [_feed("f9", 900)]

        merged, _counts = family.merge_states(target, incoming)

        self.assertEqual(merged["baby"]["name"], "本家宝宝")
        self.assertTrue(merged["reminder"]["enabled"])
        self.assertEqual(len(merged["feeds"]), 1)

    def test_empty_baby_on_target_is_filled_from_incoming(self) -> None:
        target = _empty_state()
        target["baby"] = {"name": "", "birthday": ""}
        incoming = _empty_state()
        incoming["baby"] = {"name": "朵朵", "birthday": "2024-01-01"}

        merged, _counts = family.merge_states(target, incoming)

        self.assertEqual(merged["baby"]["name"], "朵朵")

    def test_archived_and_hero_are_merged(self) -> None:
        target = _empty_state()
        target["archived"] = {"feeds": [_feed("a1", 10)], "photos": []}
        target["heroPhotoIds"] = ["p1"]
        incoming = _empty_state()
        incoming["archived"] = {"feeds": [_feed("a2", 20)], "photos": []}
        incoming["heroPhotoIds"] = ["p1", "p2"]
        incoming["photos"] = [{"id": "p2", "at": 5}]

        merged, counts = family.merge_states(target, incoming)

        self.assertEqual([item["id"] for item in merged["archived"]["feeds"]], ["a2", "a1"])
        self.assertEqual(merged["heroPhotoIds"], ["p1", "p2"])
        self.assertEqual(counts, {"photos": 1})

    def test_duplicate_timestamps_keep_stable_order(self) -> None:
        target = _empty_state()
        target["diapers"] = [{"id": "d1", "at": 50, "kind": "wet"}]
        incoming = _empty_state()
        incoming["diapers"] = [{"id": "d2", "at": 50, "kind": "dirty"}]

        merged, _counts = family.merge_states(target, incoming)

        self.assertEqual([item["id"] for item in merged["diapers"]], ["d1", "d2"])

    def test_has_records_ignores_empty_shell(self) -> None:
        self.assertFalse(family._has_records(_empty_state()))
        with_trash = _empty_state()
        with_trash["trash"] = [{"id": "t1", "deletedAt": 1}]
        self.assertTrue(family._has_records(with_trash))


if __name__ == "__main__":
    unittest.main()
