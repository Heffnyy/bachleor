# Task Extractor Service

This repo turns transcript text into structured tasks using a separate AI service.

## Setup
```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip setuptools wheel
python -m pip install -r requirements.txt
cp .env.example .env
python -m uvicorn app.main:app --reload --port 8002
```

## Environment
- `OPENAI_API_KEY`
- `OPENAI_MODEL=gpt-4o-mini`

## API
- `GET /health`
- `POST /extract-tasks`
