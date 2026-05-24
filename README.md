# AI Transcription System

This workspace contains four separate repos:

- `backend`: Django API to save transcripts and uploaded audio metadata.
- `frontend`: Next.js app to upload files and display saved transcripts.
- `transcriber`: Separate AI service that runs the transcription model.
- `task-extractor`: Separate AI service that converts transcripts into tasks.

## Architecture
1. The user uploads an Arabic or English recording in the Next.js app.
2. The frontend sends the file to the Django backend.
3. Django stores the uploaded file and calls the transcription AI service.
4. The AI service transcribes the audio with `faster-whisper`.
5. Django sends the transcript to the task extraction AI service.
6. Django saves the returned text and tasks and exposes both to the frontend.

## Run Order
### 1. Start the transcription AI service
```bash
cd transcriber
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip setuptools wheel
python -m pip install -r requirements.txt
cp .env.example .env
python -m uvicorn app.main:app --reload --port 8001
```

### 2. Start the task extraction AI service
```bash
cd task-extractor
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip setuptools wheel
python -m pip install -r requirements.txt
cp .env.example .env
python -m uvicorn app.main:app --reload --port 8002
```

### 3. Start the Django backend
```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip setuptools wheel
python -m pip install -r requirements.txt
cp .env.example .env
python manage.py migrate
python manage.py runserver 8000
```

### 4. Start the Next.js frontend
```bash
"cd frontend
npm install
cp .env.local.example .env.local
npm run dev"
```

## Default URLs
- Frontend: `http://localhost:3000`
- Backend: `http://127.0.0.1:8000`
- Transcriber: `http://127.0.0.1:8001`
- Task extractor: `http://127.0.0.1:8002`

## Extra Note
- Install `ffmpeg` before running the AI service.
- Add your OpenAI API key to `task-extractor/.env` before starting the task extractor.
