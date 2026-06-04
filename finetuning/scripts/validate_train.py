"""
Validate the base-model swap on the GPU only — train → GGUF export → HF push.

This is the part of the pipeline that actually exercises the base model
(loads it 4-bit on the L4, attaches LoRA, trains, exports a q4_k_m GGUF, and
pushes both artifacts to HF). It deliberately SKIPS the local Ollama gate from
run_company.py, which is unsuitable here: a 24B q4 GGUF is ~14GB and won't load
sanely into Ollama on a 16GB-RAM Mac, and the Claude judge needs an
ANTHROPIC_API_KEY that isn't set. Use run_one_company.py for the full cycle on a
box that can serve the model.

Usage:
    modal run scripts/validate_train.py
    modal run scripts/validate_train.py --company-id <uuid>
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from modal_app import app, run_training
from src.dataset.builder import build_from_signals, write_jsonl

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

DEFAULT_COMPANY_ID = "aaaaaaaa-0000-0000-0000-000000000001"
COMPANY_NAME = "Acme Ventures"


@app.local_entrypoint()
def main(company_id: str = DEFAULT_COMPANY_ID) -> None:
    examples, _consumed = build_from_signals(company_id, COMPANY_NAME)
    log.info("Built %d training examples for %s", len(examples), COMPANY_NAME)

    jsonl_path = write_jsonl(examples, company_id)
    dataset_jsonl = Path(jsonl_path).read_text()

    log.info("Kicking GPU train on Modal (Mistral Small 24B, L4)...")
    result = run_training.remote(company_id, dataset_jsonl, version=1)
    log.info("DONE. Train result: %s", result)
