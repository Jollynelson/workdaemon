HYPERPARAMS: dict = {
    "max_seq_length": 4096,       # Qwen3-32B on L40S (48GB) — see config.py note
    "lora_r": 16,
    "lora_alpha": 16,
    "lora_dropout": 0.0,          # Unsloth recommends 0 for speed
    "target_modules": [
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj",
    ],
    # Qwen3-32B QLoRA on L40S 48GB: batch=1 + grad_accum=8 (effective batch 8) at
    # seq=4096. 32B 4-bit weights are ~19GB; the L40S leaves plenty for activations.
    "per_device_train_batch_size": 1,
    "gradient_accumulation_steps": 8,
    "warmup_steps": 5,
    "num_train_epochs": 2,        # small datasets; 2 epochs prevents catastrophic forgetting
    "learning_rate": 2e-4,
    "weight_decay": 0.01,
    "lr_scheduler_type": "linear",
    "optim": "adamw_8bit",
    "seed": 3407,
    # If it OOMs on the L40S (shouldn't at seq=4096): drop max_seq_length, or step
    # up to gpu="A100" in modal_app.py.
}
