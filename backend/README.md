# Django Backend

This service stores uploaded audio files and the resulting transcript text.

## Features
- Accepts audio uploads from the frontend.
- Calls the separate AI transcription service.
- Calls the separate AI task extraction service.
- Saves transcript text, language, duration, status, and extracted tasks.
- Exposes REST endpoints for listing and retrieving transcripts.

## Setup
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python manage.py migrate
python manage.py runserver 8000
```

## Environment
- `TRANSCRIBER_SERVICE_URL=http://127.0.0.1:8001`
- `TASK_EXTRACTOR_SERVICE_URL=http://127.0.0.1:8002`

## API
- `GET /api/transcriptions/`
- `POST /api/transcriptions/` with multipart form field `file`
- `GET /api/transcriptions/{id}/`
- `GET /api/transcriptions/health/`
