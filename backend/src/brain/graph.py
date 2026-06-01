"""Knowledge graph — people, decisions, projects, relationships (FINAL spec).

Neo4j in prod (per-company label/property scoping); a Driver protocol lets tests
use an in-memory fake. Every node/edge carries company_id so a query can never
cross companies.
"""

from __future__ import annotations

from typing import Any, Protocol


class GraphDriver(Protocol):
    def run(self, cypher: str, params: dict) -> list[dict]: ...


class KnowledgeGraph:
    def __init__(self, company_id: str, driver: GraphDriver) -> None:
        self._company_id = company_id
        self._driver = driver

    def upsert_entity(self, label: str, key: str, props: dict | None = None) -> None:
        props = {**(props or {}), "company_id": self._company_id, "key": key}
        self._driver.run(
            f"MERGE (n:{_safe(label)} {{key: $key, company_id: $company_id}}) SET n += $props",
            {"key": key, "company_id": self._company_id, "props": props},
        )

    def relate(self, from_key: str, rel: str, to_key: str) -> None:
        self._driver.run(
            f"MATCH (a {{key: $a, company_id: $c}}), (b {{key: $b, company_id: $c}}) "
            f"MERGE (a)-[:{_safe(rel)}]->(b)",
            {"a": from_key, "b": to_key, "c": self._company_id},
        )

    def neighbors(self, key: str) -> list[dict]:
        rows = self._driver.run(
            "MATCH (a {key: $key, company_id: $c})-[r]->(b {company_id: $c}) "
            "RETURN type(r) AS rel, b.key AS key",
            {"key": key, "c": self._company_id},
        )
        return rows


def _safe(token: str) -> str:
    """Cypher labels/rel-types can't be parameterized; allow only safe identifiers."""
    if not token.replace("_", "").isalnum():
        raise ValueError(f"unsafe graph identifier: {token!r}")
    return token


def neo4j_driver() -> GraphDriver:  # pragma: no cover - needs live Neo4j
    from neo4j import GraphDatabase

    from src.config import settings

    _drv = GraphDatabase.driver(
        settings.neo4j_url, auth=(settings.neo4j_user, settings.neo4j_password)
    )

    class _Neo4j:
        def run(self, cypher: str, params: dict) -> list[dict]:
            with _drv.session() as s:
                return [r.data() for r in s.run(cypher, **params)]

    return _Neo4j()
