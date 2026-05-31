"""
MANDATORY isolation tests — must pass before every release.

Tests that no data, model, or vector namespace ever crosses company boundaries.
These tests do NOT require a running DB or GPU — they test the structural
guarantees in naming.py and vectors.py.

A failing test here is a release blocker. No exceptions.
"""

from __future__ import annotations

import pytest

from src.model.naming import (
    adapter_repo,
    assert_namespace_scoped,
    company_namespace,
    role_namespace,
    user_namespace,
    wd_model,
    wd_eval_model,
)

COMPANY_A = "aaaaaaaa-0001-0001-0001-000000000001"
COMPANY_B = "bbbbbbbb-0002-0002-0002-000000000002"
STAFF_A1  = "staff-a1-0000-0000-0000-000000000001"
STAFF_B1  = "staff-b1-0000-0000-0000-000000000001"


# ── Model isolation ───────────────────────────────────────────────────────────

class TestModelIsolation:
    def test_model_names_differ_between_companies(self):
        assert wd_model(COMPANY_A) != wd_model(COMPANY_B)

    def test_model_name_contains_company_id(self):
        assert COMPANY_A in wd_model(COMPANY_A)
        assert COMPANY_B in wd_model(COMPANY_B)

    def test_eval_model_differs_from_deployed(self):
        assert wd_eval_model(COMPANY_A) != wd_model(COMPANY_A)

    def test_company_b_model_not_in_company_a_name(self):
        assert COMPANY_B not in wd_model(COMPANY_A)


# ── Adapter repo isolation ────────────────────────────────────────────────────

class TestAdapterRepoIsolation:
    def test_adapter_repos_differ_between_companies(self):
        assert adapter_repo(COMPANY_A) != adapter_repo(COMPANY_B)

    def test_adapter_repo_contains_company_id(self):
        assert COMPANY_A in adapter_repo(COMPANY_A)

    def test_company_b_not_in_company_a_repo(self):
        assert COMPANY_B not in adapter_repo(COMPANY_A)


# ── Vector namespace isolation ────────────────────────────────────────────────

class TestVectorNamespaceIsolation:
    def test_company_namespaces_differ(self):
        assert company_namespace(COMPANY_A) != company_namespace(COMPANY_B)

    def test_user_namespace_scoped_to_company(self):
        ns_a = user_namespace(STAFF_A1, COMPANY_A)
        ns_b = user_namespace(STAFF_A1, COMPANY_B)  # same staff ID, different company
        assert ns_a != ns_b
        assert COMPANY_A in ns_a
        assert COMPANY_B in ns_b

    def test_user_namespace_not_cross_company(self):
        ns_a = user_namespace(STAFF_A1, COMPANY_A)
        assert COMPANY_B not in ns_a

    def test_staff_b_namespace_not_in_company_a_namespace(self):
        ns_a = user_namespace(STAFF_A1, COMPANY_A)
        ns_b = user_namespace(STAFF_B1, COMPANY_B)
        # Namespaces are completely distinct
        assert ns_a != ns_b

    def test_role_namespace_scoped_to_company(self):
        ns_a = role_namespace("CEO", COMPANY_A)
        ns_b = role_namespace("CEO", COMPANY_B)
        assert ns_a != ns_b
        assert COMPANY_A in ns_a
        assert COMPANY_B not in ns_a


# ── assert_namespace_scoped enforcement ──────────────────────────────────────

class TestNamespaceEnforcement:
    def test_valid_namespace_passes(self):
        ns = company_namespace(COMPANY_A)
        assert_namespace_scoped(ns, COMPANY_A)  # should not raise

    def test_cross_company_namespace_raises(self):
        ns = company_namespace(COMPANY_B)
        with pytest.raises(PermissionError):
            assert_namespace_scoped(ns, COMPANY_A)

    def test_user_namespace_wrong_company_raises(self):
        ns = user_namespace(STAFF_B1, COMPANY_B)
        with pytest.raises(PermissionError):
            assert_namespace_scoped(ns, COMPANY_A)

    def test_arbitrary_namespace_raises(self):
        with pytest.raises(PermissionError):
            assert_namespace_scoped("some_other_namespace", COMPANY_A)

    def test_empty_namespace_raises(self):
        with pytest.raises(PermissionError):
            assert_namespace_scoped("", COMPANY_A)


# ── DB query isolation (structural) ──────────────────────────────────────────

class TestDBQueryIsolation:
    """
    Verify that every DB helper in db.py takes company_id as its first argument.
    This is a structural test — no DB connection needed.
    """
    def test_get_unused_training_signals_requires_company_id(self):
        import inspect
        from src import db
        sig = inspect.signature(db.get_unused_training_signals)
        params = list(sig.parameters.keys())
        assert params[0] == "company_id", "get_unused_training_signals must take company_id first"

    def test_get_eval_training_signals_requires_company_id(self):
        import inspect
        from src import db
        sig = inspect.signature(db.get_eval_training_signals)
        params = list(sig.parameters.keys())
        assert params[0] == "company_id"

    def test_get_company_terminology_requires_company_id(self):
        import inspect
        from src import db
        sig = inspect.signature(db.get_company_terminology)
        params = list(sig.parameters.keys())
        assert params[0] == "company_id"

    def test_mark_signals_used_requires_company_id(self):
        import inspect
        from src import db
        sig = inspect.signature(db.mark_signals_used)
        params = list(sig.parameters.keys())
        assert params[0] == "company_id"

    def test_get_deployed_version_requires_company_id(self):
        import inspect
        from src import db
        sig = inspect.signature(db.get_deployed_version)
        params = list(sig.parameters.keys())
        assert params[0] == "company_id"


# ── Tool permission isolation ─────────────────────────────────────────────────

class TestToolPermissionIsolation:
    def test_junior_cannot_access_finance(self):
        from src.tools.registry import is_permitted
        assert not is_permitted("finance_summary", "junior")
        assert not is_permitted("finance_invoices", "junior")
        assert not is_permitted("hr_headcount", "junior")

    def test_junior_cannot_access_crm_write(self):
        from src.tools.registry import is_permitted
        assert not is_permitted("crm_update_deal", "junior")

    def test_executive_can_access_all(self):
        from src.tools.registry import is_permitted
        for tool in ["slack_search", "notion_search", "crm_lookup", "finance_summary", "hr_alerts"]:
            assert is_permitted(tool, "executive"), f"executive should have {tool}"

    def test_manager_cannot_access_hr(self):
        from src.tools.registry import is_permitted
        assert not is_permitted("hr_headcount", "manager")

    def test_director_cannot_access_hr_alerts(self):
        from src.tools.registry import is_permitted
        # hr_alerts is executive-only
        assert not is_permitted("hr_alerts", "director")
