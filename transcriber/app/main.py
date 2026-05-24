from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from .config import get_settings
from .engine import WhisperEngine
from .schemas import TranscriptionResponse

app = FastAPI(title=get_settings().app_name)
engine = WhisperEngine()


@app.get('/health')
def healthcheck() -> dict:
    return {'status': 'ok'}


@app.post('/transcribe', response_model=TranscriptionResponse)
async def transcribe(
    file: UploadFile = File(...),
    language: str | None = Form(default=None),
) -> TranscriptionResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail='A filename is required.')

    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail='The uploaded file is empty.')
    await file.seek(0)

    normalized_language = (language or '').strip().lower() or None
    if normalized_language not in {None, 'ar', 'en'}:
        raise HTTPException(status_code=400, detail='language must be one of: ar, en, or omitted.')

    result = engine.transcribe_upload(file.filename, file.file, language=normalized_language)
    return TranscriptionResponse(**result)
