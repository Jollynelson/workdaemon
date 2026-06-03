"""
Unsloth QLoRA training loop — runs inside Modal on an L4 GPU (Gemma 4 12B base).

Uses the standard HuggingFace Trainer (not SFTTrainer) to avoid trl's EOS token
validation, which fails because the Unsloth model repo ships the wrong eos_token
in its tokenizer_config.json.

All imports are deferred inside train_adapter() so this module is safe to import
on CPU without GPU packages installed.
"""

from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)


def train_adapter(
    company_id: str,
    dataset_path: str,
    base_model: str,
    hp: dict,
) -> str:
    """
    Fine-tune a QLoRA adapter for one company.

    Returns:
        Path to the saved adapter directory (LoRA weights + tokenizer only).
    """
    # unsloth must be imported first so its patches apply before transformers loads
    import unsloth  # noqa: F401
    from datasets import load_dataset
    from transformers import (
        AutoTokenizer,
        DataCollatorForLanguageModeling,
        Trainer,
        TrainingArguments,
    )
    from unsloth import FastLanguageModel

    # ── 1. Load base model in 4-bit ───────────────────────────────────────────
    logger.info("Loading base model %s ...", base_model)
    model, _ = FastLanguageModel.from_pretrained(
        model_name=base_model,
        max_seq_length=hp["max_seq_length"],
        load_in_4bit=True,
    )

    # ── 2. Attach LoRA adapter ────────────────────────────────────────────────
    model = FastLanguageModel.get_peft_model(
        model,
        r=hp["lora_r"],
        target_modules=hp["target_modules"],
        lora_alpha=hp["lora_alpha"],
        lora_dropout=hp["lora_dropout"],
        use_gradient_checkpointing="unsloth",
        random_state=hp["seed"],
        bias="none",
    )

    # ── 3. Load tokenizer ─────────────────────────────────────────────────────
    # Gemma 4 uses <start_of_turn>/<end_of_turn> turns (eos = <end_of_turn>) and
    # ships its chat_template as a single string, so apply_chat_template below
    # produces Gemma format with no override. Gemma's tokenizer already defines a
    # <pad> token, so the fallback below is a no-op for it (kept for other bases).
    tokenizer = AutoTokenizer.from_pretrained(base_model)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # ── 4. Load and tokenize dataset ──────────────────────────────────────────
    logger.info("Loading dataset from %s ...", dataset_path)
    ds = load_dataset("json", data_files=dataset_path, split="train")

    def _format_and_tokenize(example: dict) -> dict:
        text = tokenizer.apply_chat_template(
            example["messages"],
            tokenize=False,
            add_generation_prompt=False,
        )
        return tokenizer(
            text,
            truncation=True,
            max_length=hp["max_seq_length"],
            padding=False,   # DataCollatorForLanguageModeling pads per-batch
        )

    tokenized_ds = ds.map(
        _format_and_tokenize,
        batched=False,
        remove_columns=ds.column_names,
    )
    logger.info("Dataset size: %d examples", len(tokenized_ds))

    # ── 5. Train ──────────────────────────────────────────────────────────────
    out_dir = f"/tmp/{company_id}-adapter"
    os.makedirs(out_dir, exist_ok=True)

    trainer = Trainer(
        model=model,
        train_dataset=tokenized_ds,
        data_collator=DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False),
        args=TrainingArguments(
            output_dir=out_dir,
            per_device_train_batch_size=hp["per_device_train_batch_size"],
            gradient_accumulation_steps=hp["gradient_accumulation_steps"],
            warmup_steps=hp["warmup_steps"],
            num_train_epochs=hp["num_train_epochs"],
            learning_rate=hp["learning_rate"],
            weight_decay=hp["weight_decay"],
            lr_scheduler_type=hp["lr_scheduler_type"],
            optim=hp["optim"],
            seed=hp["seed"],
            fp16=not _is_bfloat16_supported(),
            bf16=_is_bfloat16_supported(),
            logging_steps=1,
            save_strategy="no",
            report_to="none",
        ),
    )

    logger.info("Starting training ...")
    trainer.train()
    logger.info("Training complete.")

    # ── 6. Save LoRA adapter (safetensors) ────────────────────────────────────
    model.save_pretrained(out_dir)
    tokenizer.save_pretrained(out_dir)
    logger.info("LoRA adapter saved to %s", out_dir)

    # ── 7. Export merged GGUF for Ollama serving ──────────────────────────────
    # Unsloth merges the adapter into the base model and quantizes to GGUF in
    # one step. q4_k_m on a 12B is ~7GB — fits the L4 and serves fine on Ollama.
    # Ollama's ADAPTER directive requires GGUF format; exporting here avoids
    # a separate conversion step outside the GPU container.
    gguf_dir = f"/tmp/{company_id}-gguf"
    os.makedirs(gguf_dir, exist_ok=True)

    # Gemma 4 ships chat_template as a single string, so the coercion below is a
    # no-op for it. It's retained as a safety net: some Unsloth repos (e.g. the old
    # Hermes-3 base) ship chat_template as a DICT/LIST of named templates, and
    # Unsloth's GGUF exporter (fix_tokenizer_bos_token) calls `.replace(" ", "")`
    # on it and crashes on a non-string. Coerce to the single 'default' string —
    # the same one apply_chat_template used during training.
    _ct = getattr(tokenizer, "chat_template", None)
    if isinstance(_ct, dict):
        tokenizer.chat_template = _ct.get("default") or next(iter(_ct.values()))
        logger.info("Coerced dict chat_template → 'default' string for GGUF export.")
    elif isinstance(_ct, list):
        # transformers multi-template format: [{"name": ..., "template": ...}, ...]
        _default = next((t.get("template") for t in _ct if t.get("name") == "default"), None)
        tokenizer.chat_template = _default or _ct[0].get("template")
        logger.info("Coerced list chat_template → 'default' string for GGUF export.")

    logger.info("Exporting merged GGUF (q4_k_m) for Ollama...")
    model.save_pretrained_gguf(gguf_dir, tokenizer, quantization_method="q4_k_m")

    # Unsloth may save the GGUF inside gguf_dir, alongside it, or in /tmp.
    # Search all plausible locations and log what we find.
    import glob as _glob

    def _find_gguf() -> str | None:
        candidates = (
            _glob.glob(os.path.join(gguf_dir, "*.gguf"))                         # inside dir
            + _glob.glob(os.path.join(gguf_dir, "**", "*.gguf"), recursive=True) # subdirs
            + _glob.glob(os.path.join(f"{gguf_dir}_gguf", "*.gguf"))             # Unsloth appends _gguf
            + _glob.glob(f"{gguf_dir}*.gguf")                                     # dir-as-prefix
            + _glob.glob("/tmp/*.gguf")                                            # /tmp root
        )
        return candidates[0] if candidates else None

    gguf_path = _find_gguf()
    if not gguf_path:
        # Log directory state to diagnose on next run
        contents = os.listdir(gguf_dir) if os.path.exists(gguf_dir) else []
        tmp_gguf = _glob.glob("/tmp/**/*.gguf", recursive=True)
        raise RuntimeError(
            f"GGUF export produced no .gguf file.\n"
            f"  gguf_dir contents: {contents}\n"
            f"  /tmp .gguf files:  {tmp_gguf}"
        )

    logger.info("GGUF exported to %s", gguf_path)

    return out_dir, gguf_path


def _is_bfloat16_supported() -> bool:
    """T4 does not support bf16; A10G/A100/H100 do."""
    try:
        import torch
        return torch.cuda.is_bf16_supported()
    except Exception:
        return False
