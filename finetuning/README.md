# WorkDaemon Fine-Tuning Pipeline

Continuous per-company fine-tuning of Llama 3.1 8B with QLoRA (Unsloth) on Modal GPUs.

Every 48 hours, for each active company:
1. Build a training dataset from recent signals (queries, feedback, self-critiques, terminology)
2. Spin up a T4 GPU on Modal
3. Fine-tune a QLoRA adapter with Unsloth
4. Push the adapter to a private Hugging Face repo scoped to that company
5. Run a quality gate — only deploy if the new adapter beats the current one
6. Hot-swap the adapter into Ollama for serving
7. Shut the GPU down

**Cost:** ~$10 / company / month.

## Setup

```bash
cp .env.example .env
# fill in .env

pip install -e ".[dev]"

# run the DB migration
python scripts/run_migration.py
```

## Running locally (one company)

```bash
python scripts/run_one_company.py --company-id <uuid>
```

## Project structure

```
src/
  config.py           — env + constants
  db.py               — Supabase client, all queries scoped by company_id
  dataset/            — builds training JSONL from signals
  training/           — Unsloth QLoRA loop (runs on Modal GPU)
  registry/           — push/pull adapters to/from Hugging Face
  evaluation/         — quality gate (new adapter must beat old)
  serving/            — loads adapter into Ollama
  orchestration/      — Inngest cron + per-company fan-out
modal_app.py          — Modal app definition + GPU function
scripts/              — manual triggers and test data seeding
tests/
```
