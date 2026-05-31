"""
Load a company's merged GGUF model into Ollama for inference.

Training (train.py) exports a merged GGUF (q4_k_m) via Unsloth alongside the
LoRA adapter safetensors. The GGUF is pushed to HF and pulled here. The
Modelfile uses FROM <gguf_path> — no ADAPTER directive needed, which avoids
format-mismatch issues with Ollama's ADAPTER instruction.
"""

from __future__ import annotations

import logging
import os
import subprocess
import tempfile

import httpx

from src.dataset.formatters import SYSTEM_PROMPT

logger = logging.getLogger(__name__)

OLLAMA_BIN = os.environ.get("OLLAMA_BIN", "ollama")
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_BASE_MODEL = "llama3.1:8b"


# ── Naming ─────────────────────────────────────────────────────────────────────


def model_name(company_id: str) -> str:
    """Ollama model name for a company's deployed adapter."""
    return f"wd-{company_id}"


def eval_model_name(company_id: str) -> str:
    """Temporary Ollama model name used during gate evaluation."""
    return f"wd-{company_id}-eval"


# ── Modelfile ──────────────────────────────────────────────────────────────────


def build_modelfile(company_id: str, gguf_path: str, company_name: str) -> str:
    """
    Write an Ollama Modelfile to a temp file and return its path.

    Uses FROM <gguf_path> — the merged GGUF produced by Unsloth during training.
    No ADAPTER directive: that requires a GGUF-format LoRA file which Ollama's
    tooling is inconsistent about, whereas FROM with a merged GGUF always works.
    """
    abs_gguf = os.path.abspath(gguf_path)
    system = SYSTEM_PROMPT(company_name)

    content = (
        f"FROM {abs_gguf}\n"
        f"PARAMETER temperature 0.3\n"
        f'SYSTEM """{system}"""\n'
    )

    fd, path = tempfile.mkstemp(prefix=f"wd-{company_id}-", suffix=".Modelfile")
    with os.fdopen(fd, "w") as f:
        f.write(content)

    logger.debug("Wrote Modelfile to %s", path)
    return path


# ── Ollama operations ──────────────────────────────────────────────────────────


def load_into_ollama(
    company_id: str,
    gguf_path: str,
    company_name: str,
    name: str | None = None,
) -> None:
    """
    Register the merged GGUF model as an Ollama model.

    Args:
        company_id:   Used to derive the default model name.
        gguf_path:    Local path to the merged .gguf file (pulled from HF).
        company_name: Used for the system prompt in the Modelfile.
        name:         Override the Ollama model name (used for temp eval models).
    """
    ollama_name = name or model_name(company_id)
    modelfile_path = build_modelfile(company_id, gguf_path, company_name)

    try:
        result = subprocess.run(
            [OLLAMA_BIN, "create", ollama_name, "-f", modelfile_path],
            check=True,
            capture_output=True,
            text=True,
        )
        logger.info("Loaded adapter into Ollama as '%s'.", ollama_name)
        if result.stdout:
            logger.debug("ollama create stdout: %s", result.stdout.strip())
    except subprocess.CalledProcessError as exc:
        logger.error(
            "ollama create failed for '%s': %s", ollama_name, exc.stderr.strip()
        )
        raise
    finally:
        os.unlink(modelfile_path)


def remove_from_ollama(name: str) -> None:
    """Remove an Ollama model (used for cleanup of temp eval models)."""
    try:
        subprocess.run(
            [OLLAMA_BIN, "rm", name],
            check=True,
            capture_output=True,
            text=True,
        )
        logger.info("Removed Ollama model '%s'.", name)
    except subprocess.CalledProcessError as exc:
        logger.warning("ollama rm failed for '%s': %s", name, exc.stderr.strip())


def is_loaded(company_id: str) -> bool:
    """Return True if the company's adapter model exists in Ollama."""
    try:
        resp = httpx.get(
            f"{OLLAMA_BASE_URL}/api/tags",
            timeout=5.0,
        )
        resp.raise_for_status()
        names = [m["name"].split(":")[0] for m in resp.json().get("models", [])]
        return model_name(company_id) in names
    except Exception:
        return False
