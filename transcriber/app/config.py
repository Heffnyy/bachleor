from functools import lru_cache
import os

from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()


class Settings(BaseModel):
    app_name: str = os.getenv('APP_NAME', 'AI Transcriber Service')
    whisper_model_size: str = os.getenv('WHISPER_MODEL_SIZE', 'small')
    compute_type: str = os.getenv('WHISPER_COMPUTE_TYPE', 'int8')
    device: str = os.getenv('WHISPER_DEVICE', 'cpu')
    beam_size: int = int(os.getenv('WHISPER_BEAM_SIZE', '1'))


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
