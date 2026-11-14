import unittest

import backup


class RestoreOrderTest(unittest.TestCase):
    def test_old_backup_only_restores_what_it_has(self):
        # 老格式只有 4 张用户表；不能因为 TABLES 变长就去清空 household_*
        order = backup._restore_order({"users": [], "sessions": [], "user_state": [], "media": []})
        self.assertEqual(order, ["users", "sessions", "user_state", "media"])

    def test_new_backup_restores_family_tables(self):
        payload = {name: [] for name in backup.TABLES}
        order = backup._restore_order(payload)
        self.assertEqual(order, list(backup.TABLES))

    def test_households_come_before_household_state(self):
        order = backup._restore_order({name: [] for name in backup.TABLES})
        self.assertLess(order.index("households"), order.index("household_state"))
        self.assertLess(order.index("households"), order.index("household_members"))

    def test_tables_cover_household_state(self):
        # 数据现在存在 household_state；备份漏了这张表等于没备份
        self.assertIn("household_state", backup.TABLES)
        self.assertIn("household_members", backup.TABLES)
        self.assertIn("invites", backup.TABLES)

    def test_empty_payload_is_rejected(self):
        self.assertEqual(backup._restore_order({}), [])


if __name__ == "__main__":
    unittest.main()
