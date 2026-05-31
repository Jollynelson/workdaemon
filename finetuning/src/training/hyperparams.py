HYPERPARAMS: dict = {
    "max_seq_length": 8192,
    "lora_r": 16,
    "lora_alpha": 16,
    "lora_dropout": 0.0,          # Unsloth recommends 0 for speed
    "target_modules": [
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj",
    ],
    "per_device_train_batch_size": 2,
    "gradient_accumulation_steps": 4,
    "warmup_steps": 5,
    "num_train_epochs": 2,        # small datasets; 2 epochs prevents catastrophic forgetting
    "learning_rate": 2e-4,
    "weight_decay": 0.01,
    "lr_scheduler_type": "linear",
    "optim": "adamw_8bit",
    "seed": 3407,
    # T4 OOM fallback: set per_device_train_batch_size=1 and
    # gradient_accumulation_steps=8, or switch gpu="A10G" in modal_app.py.
}
