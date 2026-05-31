"""
Manual trigger: run the full fine-tuning pipeline for a single company.

Usage:
    modal run scripts/run_one_company.py
    modal run scripts/run_one_company.py --company-id <uuid>
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from modal_app import app
from src.orchestration.run_company import run_company

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")

DEFAULT_COMPANY_ID = "aaaaaaaa-0000-0000-0000-000000000001"


@app.local_entrypoint()
def main(company_id: str = DEFAULT_COMPANY_ID) -> None:
    run_company(company_id)
