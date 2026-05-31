from __future__ import annotations

import logging
import os
import tempfile

from huggingface_hub import HfApi, hf_hub_download, snapshot_download

from src.config import settings

logger = logging.getLogger(__name__)

_api: HfApi | None = None


def _hf() -> HfApi:
    global _api
    if _api is None:
        _api = HfApi(token=settings.hf_token)
    return _api


# ── Public API ─────────────────────────────────────────────────────────────────


def repo_name(company_id: str) -> str:
    return f"{settings.hf_org}/{company_id}-adapter"


def ensure_repo(company_id: str) -> None:
    """Create the private adapter repo if it doesn't already exist."""
    _hf().create_repo(
        repo_id=repo_name(company_id),
        private=True,
        exist_ok=True,
    )
    logger.debug("Ensured repo %s exists.", repo_name(company_id))


def push(company_id: str, local_dir: str, version: int) -> str:
    """
    Upload the adapter folder to the company's private HF repo.
    Returns the commit hash (revision) for storage in model_versions.
    """
    ensure_repo(company_id)

    commit_info = _hf().upload_folder(
        repo_id=repo_name(company_id),
        folder_path=local_dir,
        commit_message=f"v{version}",
    )

    revision: str = commit_info.oid
    logger.info(
        "Pushed adapter for company=%s version=%d revision=%s",
        company_id,
        version,
        revision,
    )
    return revision


def pull(company_id: str, revision: str | None = None) -> str:
    """
    Download the LoRA adapter (safetensors) to a local temp directory.
    Uses the latest commit if revision is None.
    """
    local_dir = tempfile.mkdtemp(prefix=f"{company_id}-adapter-")

    snapshot_download(
        repo_id=repo_name(company_id),
        revision=revision,
        local_dir=local_dir,
        token=settings.hf_token,
        ignore_patterns=["*.gguf"],   # skip the large GGUF when only adapter needed
    )

    logger.info(
        "Pulled adapter for company=%s revision=%s to %s",
        company_id,
        revision or "latest",
        local_dir,
    )
    return local_dir


def push_gguf(company_id: str, gguf_path: str, version: int) -> None:
    """
    Upload the merged GGUF model to the company's HF repo under v{version}/model.gguf.
    This file is used by ollama_loader to serve the model via Ollama.
    """
    ensure_repo(company_id)

    _hf().upload_file(
        path_or_fileobj=gguf_path,
        path_in_repo=f"v{version}/model.gguf",
        repo_id=repo_name(company_id),
        commit_message=f"v{version} GGUF (q4_k_m)",
    )
    logger.info(
        "Pushed GGUF for company=%s version=%d (%s)",
        company_id,
        version,
        os.path.basename(gguf_path),
    )


def pull_gguf(company_id: str, version: int) -> str:
    """
    Download the merged GGUF model for a specific version.
    Returns the local path to the .gguf file.
    """
    local_dir = tempfile.mkdtemp(prefix=f"{company_id}-gguf-")

    local_path = hf_hub_download(
        repo_id=repo_name(company_id),
        filename=f"v{version}/model.gguf",
        local_dir=local_dir,
        token=settings.hf_token,
    )

    logger.info(
        "Pulled GGUF for company=%s version=%d to %s", company_id, version, local_path
    )
    return local_path
