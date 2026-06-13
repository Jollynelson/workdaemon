"""Phase 2.5 — corpus → Q&A training data.

Conversational data per company is thin; the rich asset is `workspace_documents`
(the deep Slack/doc history). This turns that corpus into GROUNDED question→answer
training pairs via a cheap LLM pass (DeepSeek by default), so a company clears
MIN_EXAMPLES_TO_TRAIN with examples drawn from its OWN knowledge. Synthetic but
grounded: every answer must be supported by the source document (the prompt
forbids outside knowledge), and the doc is the only context the model sees.
"""
from __future__ import annotations

import json
import logging
import os

import httpx

import src.db as db
from src.config import settings
from src.dataset import formatters

logger = logging.getLogger(__name__)

QA_MAX_DOCS = int(os.environ.get("QA_MAX_DOCS", "80"))   # cap LLM calls (1 per doc)
QA_PER_DOC = int(os.environ.get("QA_PER_DOC", "4"))      # pairs requested per doc
_MIN_DOC_WORDS = 20                                       # skip near-empty docs

# Mirror the gate's judge providers (DeepSeek default; OpenAI-compatible or SDK).
_PROVIDERS = {
    "deepseek": {"base_url": None, "default_model": "deepseek-chat"},
    "openai": {"base_url": "https://api.openai.com/v1", "default_model": "gpt-4o-mini"},
    "anthropic": {"base_url": None, "default_model": "claude-haiku-4-5-20251001"},
}


def _llm_config() -> tuple[str, str, str, str | None]:
    provider = (settings.judge_provider or "deepseek").lower()
    cfg = _PROVIDERS.get(provider)
    if cfg is None:
        raise ValueError(f"unknown provider {provider!r}")
    model = settings.judge_model or cfg["default_model"]
    key = {
        "deepseek": settings.deepseek_api_key,
        "openai": settings.openai_api_key,
        "anthropic": settings.anthropic_api_key,
    }[provider]
    if not key:
        raise ValueError(f"no API key set for provider {provider!r}")
    base_url = settings.deepseek_base_url + "/v1" if provider == "deepseek" else cfg["base_url"]
    return provider, model, key, base_url


def _complete(prompt: str, max_tokens: int = 900) -> str:
    provider, model, key, base_url = _llm_config()
    if provider == "anthropic":
        import anthropic
        client = anthropic.Anthropic(api_key=key)
        msg = client.messages.create(model=model, max_tokens=max_tokens, messages=[{"role": "user", "content": prompt}])
        return msg.content[0].text
    resp = httpx.post(
        f"{base_url}/chat/completions",
        headers={"Authorization": f"Bearer {key}"},
        json={"model": model, "messages": [{"role": "user", "content": prompt}], "max_tokens": max_tokens, "temperature": 0.3},
        timeout=60.0,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


_QA_PROMPT = """You generate TRAINING question→answer pairs for {company}'s internal AI assistant, grounded ONLY in the company document below.

DOCUMENT — {title}:
\"\"\"
{content}
\"\"\"

Write up to {n} diverse, specific Q&A pairs a teammate might ask, where every ANSWER is fully supported by the document above:
- Questions: natural and specific to {company} (use the real names, channels, and terms from the document).
- Answers: concise and factual, drawn ONLY from the document — no outside knowledge, no speculation.
- If the document has little usable content, return fewer pairs (or an empty array).
Return ONLY a JSON array, no prose: [{{"q":"...","a":"..."}}]"""


def extract_json_array(text: str) -> list[dict]:
    """Tolerantly pull the JSON array out of an LLM reply (handles code fences/prose)."""
    if not text:
        return []
    s = text.strip()
    if s.startswith("```"):
        s = s.strip("`")
        if s[:4].lower() == "json":
            s = s[4:]
    start, end = s.find("["), s.rfind("]")
    if start == -1 or end == -1 or end < start:
        return []
    try:
        data = json.loads(s[start:end + 1])
    except (ValueError, TypeError):
        return []
    return [p for p in data if isinstance(p, dict)] if isinstance(data, list) else []


def build_qa_from_corpus(
    company_id: str,
    company_name: str,
    max_docs: int = QA_MAX_DOCS,
    per_doc: int = QA_PER_DOC,
) -> list[dict]:
    """Mine grounded Q&A training examples from the company's corpus. One LLM call
    per doc; failures/empties are skipped (never block the dataset)."""
    docs = db.get_workspace_documents(company_id, limit=max_docs)
    examples: list[dict] = []
    for d in docs:
        content = (d.get("content") or "")[:6000]
        if len(content.split()) < _MIN_DOC_WORDS:
            continue
        prompt = _QA_PROMPT.format(
            company=company_name, title=d.get("title") or "doc", content=content, n=per_doc,
        )
        try:
            pairs = extract_json_array(_complete(prompt))
        except Exception as exc:  # one bad doc never blocks the rest
            logger.warning("qa synth failed for doc=%s: %s", d.get("title"), exc)
            continue
        for p in pairs[:per_doc]:
            q, a = (p.get("q") or "").strip(), (p.get("a") or "").strip()
            if not q or not formatters.is_valid_answer(a):
                continue
            examples.append(formatters._make_example(  # type: ignore[attr-defined]
                system=formatters.SYSTEM_PROMPT(company_name), user=q, assistant=a,
            ))
    logger.info(
        "company=%s synthesized %d Q&A examples from %d corpus docs",
        company_id, len(examples), len(docs),
    )
    return examples
