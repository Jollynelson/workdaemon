"""
Unsloth QLoRA training loop — runs inside Modal on an L4 GPU (Qwen3-32B base).

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
    # Qwen3 uses ChatML turns (<|im_start|>role … <|im_end|>, eos = <|im_end|>)
    # and ships its chat_template as a single string, so apply_chat_template below
    # produces ChatML with no override. Qwen3 defines <|endoftext|> as pad, so the
    # fallback below is typically a no-op (kept for safety across bases).
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

    # ── 7. Done — return the LoRA adapter dir ──────────────────────────────────
    # Path B (MULTI_LORA_PLAN): we do NOT merge to GGUF. The un-merged LoRA adapter
    # (safetensors) is what we push to HF and serve via vLLM multi-LoRA (one base +
    # per-company adapters). This also sidesteps Unsloth's brittle Qwen→GGUF
    # converter (the `target_model_dir` crash on a 32B base).
    return out_dir


def _is_bfloat16_supported() -> bool:
    """T4 does not support bf16; A10G/A100/H100 do."""
    try:
        import torch
        return torch.cuda.is_bf16_supported()
    except Exception:
        return False
