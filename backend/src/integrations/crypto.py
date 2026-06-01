"""Encrypt per-company integration tokens at rest (Fernet).

The DB stores only ciphertext; the key lives in ENCRYPTION_KEY (Modal secret).
If no key is set (dev), a deterministic dev key is derived so the flow still works
locally — but production MUST set a real ENCRYPTION_KEY.
"""

from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet

from src.config import settings


def _fernet() -> Fernet:
    key = settings.encryption_key
    if key:
        # accept either a urlsafe-base64 Fernet key or any string (derive a key)
        try:
            return Fernet(key.encode() if isinstance(key, str) else key)
        except Exception:
            digest = hashlib.sha256(key.encode()).digest()
            return Fernet(base64.urlsafe_b64encode(digest))
    # dev fallback — NOT for production
    digest = hashlib.sha256(b"workdaemon-dev-key").digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    return _fernet().decrypt(ciphertext.encode()).decode()
