from __future__ import annotations

import tempfile
from pathlib import Path
from typing import BinaryIO

from faster_whisper import WhisperModel

from .config import get_settings


class WhisperEngine:
    def __init__(self) -> None:
        settings = get_settings()
        self.model = WhisperModel(
            settings.whisper_model_size,
            device=settings.device,
            compute_type=settings.compute_type,
        )
        self.beam_size = settings.beam_size

    def transcribe_upload(self, filename: str, file_obj: BinaryIO, language: str | None = None) -> dict:
        suffix = Path(filename).suffix or '.tmp'
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(file_obj.read())
            temp_path = Path(temp_file.name)

        try:
            segments, info = self.model.transcribe(
                str(temp_path),
                beam_size=self.beam_size,
                language=language or None,
                vad_filter=True,
                condition_on_previous_text=False,
            )
            text = ' '.join(segment.text.strip() for segment in segments if segment.text.strip())
            return {
                'text': text,
                'language': info.language,
                'duration_seconds': info.duration,
            }
        finally:
            temp_path.unlink(missing_ok=True)
