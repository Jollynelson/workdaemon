"""Task board route — list a staff member's tasks, create/route a task."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from src.api.deps import company_db

router = APIRouter()


class CreateTaskRequest(BaseModel):
    company_id: str
    from_staff_id: str | None = None
    to_staff_id: str
    title: str
    brief: str = ""
    priority: str = "normal"


@router.get("/tasks/{company_id}/{staff_id}")
def list_tasks(company_id: str, staff_id: str):
    db = company_db(company_id)
    resp = db.select("tasks").eq("to_staff_id", staff_id).execute()
    return {"tasks": getattr(resp, "data", None) or []}


@router.post("/tasks")
def create_task(body: CreateTaskRequest):
    db = company_db(body.company_id)
    row = db.insert(
        "tasks",
        {
            "from_staff_id": body.from_staff_id,
            "to_staff_id": body.to_staff_id,
            "title": body.title,
            "brief": body.brief,
            "priority": body.priority,
            "status": "pending",
            "routed_by_brain": False,
        },
    )
    return {"task": row}
