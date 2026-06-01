"""Task board route — list the caller's tasks, create/route a task.

company_id + the sender are derived from the token; the caller only supplies the
assignee + task details.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from src.api.auth import Identity, resolve_identity
from src.api.deps import company_db

router = APIRouter()


class CreateTaskRequest(BaseModel):
    to_staff_id: str
    title: str
    brief: str = ""
    priority: str = "normal"


@router.get("/tasks")
def list_tasks(ident: Identity = Depends(resolve_identity)):
    db = company_db(ident.company_id)
    resp = db.select("tasks").eq("to_staff_id", ident.staff_id).execute()
    return {"tasks": getattr(resp, "data", None) or []}


@router.post("/tasks")
def create_task(body: CreateTaskRequest, ident: Identity = Depends(resolve_identity)):
    db = company_db(ident.company_id)
    row = db.insert(
        "tasks",
        {
            "from_staff_id": ident.staff_id,
            "to_staff_id": body.to_staff_id,
            "title": body.title,
            "brief": body.brief,
            "priority": body.priority,
            "status": "pending",
            "routed_by_brain": False,
        },
    )
    return {"task": row}
