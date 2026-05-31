"""Tool permission tests — role → tool access enforcement."""

from __future__ import annotations

import pytest
from src.tools.registry import is_permitted, tools_for_access_level, TOOL_PERMISSIONS


class TestPermissionHierarchy:
    """Each higher access level is a strict superset of the level below it."""

    def test_executive_is_superset_of_director(self):
        director_tools = set(TOOL_PERMISSIONS["director"])
        executive_tools = set(TOOL_PERMISSIONS["executive"])
        assert director_tools.issubset(executive_tools)

    def test_director_is_superset_of_manager(self):
        manager_tools = set(TOOL_PERMISSIONS["manager"])
        director_tools = set(TOOL_PERMISSIONS["director"])
        assert manager_tools.issubset(director_tools)

    def test_manager_is_superset_of_junior(self):
        junior_tools = set(TOOL_PERMISSIONS["junior"])
        manager_tools = set(TOOL_PERMISSIONS["manager"])
        assert junior_tools.issubset(manager_tools)


class TestJuniorRestrictions:
    def test_no_crm_write(self):
        assert not is_permitted("crm_update_deal", "junior")

    def test_no_finance(self):
        assert not is_permitted("finance_summary", "junior")
        assert not is_permitted("finance_invoices", "junior")
        assert not is_permitted("finance_cashflow", "junior")

    def test_no_hr(self):
        assert not is_permitted("hr_headcount", "junior")
        assert not is_permitted("hr_performance", "junior")
        assert not is_permitted("hr_alerts", "junior")

    def test_can_read_notion(self):
        assert is_permitted("notion_search", "junior")
        assert is_permitted("notion_get_page", "junior")

    def test_cannot_write_notion(self):
        assert not is_permitted("notion_update_page", "junior")
        assert not is_permitted("notion_create_page", "junior")


class TestManagerPermissions:
    def test_can_access_crm_read(self):
        assert is_permitted("crm_lookup", "manager")
        assert is_permitted("crm_list_deals", "manager")

    def test_cannot_access_finance(self):
        assert not is_permitted("finance_summary", "manager")

    def test_can_write_notion(self):
        assert is_permitted("notion_update_page", "manager")


class TestDirectorPermissions:
    def test_can_access_finance(self):
        assert is_permitted("finance_summary", "director")
        assert is_permitted("finance_invoices", "director")

    def test_can_access_hr_headcount(self):
        assert is_permitted("hr_headcount", "director")

    def test_cannot_access_hr_sensitive(self):
        # hr_alerts (sensitive burnout data) is executive-only
        assert not is_permitted("hr_alerts", "director")


class TestExecutivePermissions:
    def test_full_access(self):
        tools = tools_for_access_level("executive")
        for critical in ["finance_cashflow", "hr_alerts", "hr_performance", "crm_update_deal"]:
            assert critical in tools, f"executive missing {critical}"
