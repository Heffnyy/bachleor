# AI Transcriber Service

This repo hosts the speech-to-text model separately from the Django backend.

## AI Algorithm
- Uses `faster-whisper`, an optimized Whisper inference engine.
- Good fit for mixed Arabic and English speech.
- Tuned for speed with `small` model, `int8` compute, and `beam_size=1` by default.

## Setup
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8001
```

## API
- `GET /health`
- `POST /transcribe` with multipart form field `file`

## Notes
- For faster production inference, run on a GPU and set `WHISPER_DEVICE=cuda`.
- If you need more accuracy than speed, increase the model size to `medium`.
- Install `ffmpeg` on the host machine because Whisper decoding depends on it.
