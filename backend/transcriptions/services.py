from __future__ import annotations

from decimal import Decimal
from datetime import date, timedelta
from pathlib import Path
import json
import logging
import re

from django.conf import settings

logger = logging.getLogger(__name__)


class TranscriberServiceError(Exception):
    pass


class TaskExtractorServiceError(Exception):
    pass


def _openai_client():
    """Build an OpenAI client from OPENAI_API_KEY, raising a clear error if unset."""
    if not settings.OPENAI_API_KEY:
        raise TranscriberServiceError(
            'OPENAI_API_KEY is not set. Configure it in the environment so '
            'transcription and task extraction can run.'
        )
    # Imported lazily so the app can start (e.g. for migrations) without the SDK
    # configured, and so import errors surface as a clear service error.
    try:
        from openai import OpenAI
    except ImportError as exc:  # pragma: no cover - dependency missing
        raise TranscriberServiceError(f'openai package is not installed: {exc}')
    return OpenAI(api_key=settings.OPENAI_API_KEY)


def transcribe_file(file_path: Path, language: str | None = None) -> dict:
    """Transcribe an audio file in-process via the OpenAI audio API.

    Returns a dict with ``text``, ``language`` and ``duration_seconds`` keys,
    matching what the views expect.
    """
    client = _openai_client()
    try:
        with file_path.open('rb') as audio_file:
            kwargs = {
                'model': settings.OPENAI_TRANSCRIBE_MODEL,
                'file': audio_file,
                'response_format': 'verbose_json',
            }
            if language:
                kwargs['language'] = language
            result = client.audio.transcriptions.create(**kwargs)
    except Exception as exc:
        raise TranscriberServiceError(str(exc)) from exc

    return {
        'text': getattr(result, 'text', '') or '',
        'language': getattr(result, 'language', '') or '',
        'duration_seconds': getattr(result, 'duration', None),
    }


def normalize_duration(value: float | int | None) -> Decimal | None:
    if value is None:
        return None
    return Decimal(str(round(float(value), 2)))


def _chat_json(system_prompt: str, user_prompt: str, error_cls: type[Exception]) -> dict:
    """Call the OpenAI chat API and parse a JSON object response."""
    try:
        client = _openai_client()
        response = client.chat.completions.create(
            model=settings.OPENAI_CHAT_MODEL,
            messages=[
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': user_prompt},
            ],
            response_format={'type': 'json_object'},
            temperature=0,
        )
        content = response.choices[0].message.content or '{}'
        return json.loads(content)
    except error_cls:
        raise
    except Exception as exc:
        raise error_cls(str(exc)) from exc


def extract_tasks(transcript: str, available_usernames: list[str] | None = None) -> list[dict]:
    """Extract actionable tasks from a transcript in-process via the OpenAI API.

    Returns a list of dicts with ``title``, ``description``, ``priority``,
    ``assignee_username`` and ``due_date`` keys.
    """
    usernames = available_usernames or []
    system_prompt = (
        'You extract actionable tasks from a transcript of a spoken voice message. '
        'The message may be in English or Arabic. '
        'Respond ONLY with a JSON object of the form '
        '{"tasks": [{"title": str, "description": str, "priority": "low"|"medium"|"high", '
        '"assignee_username": str, "due_date": "YYYY-MM-DD"|null}]}. '
        'Use an empty string for assignee_username when no person is clearly named. '
        'Only use an assignee_username from the provided list of available usernames; '
        'if the named person is not in the list, use an empty string. '
        'Use null for due_date when no due date is mentioned. '
        'If there are no actionable tasks, return {"tasks": []}.'
    )
    user_prompt = (
        f'Available usernames: {json.dumps(usernames)}\n\n'
        f'Transcript:\n{transcript}'
    )
    payload = _chat_json(system_prompt, user_prompt, TaskExtractorServiceError)
    tasks = payload.get('tasks', [])
    return tasks if isinstance(tasks, list) else []


def translate_text(text: str, target_language: str) -> str:
    """Translate text into the target language ('en'/'ar'). Returns the original on any failure
    so a translation problem can never break task creation."""
    cleaned = (text or '').strip()
    if not cleaned:
        return text
    target_name = {'en': 'English', 'ar': 'Arabic'}.get(target_language, target_language)
    try:
        client = _openai_client()
        response = client.chat.completions.create(
            model=settings.OPENAI_CHAT_MODEL,
            messages=[
                {
                    'role': 'system',
                    'content': (
                        f'Translate the user message into {target_name}. Output only the '
                        'translation, with no quotes, labels, or commentary. If it is already '
                        f'in {target_name}, return it unchanged.'
                    ),
                },
                {'role': 'user', 'content': cleaned},
            ],
            temperature=0,
        )
        translated = (response.choices[0].message.content or '').strip()
        return translated or text
    except Exception:
        logger.exception('Translation to %s failed; keeping original text', target_language)
        return text


def normalize_due_date(value: str | None) -> date | None:
    if not value:
        return None

    normalized_value = value.strip().lower()
    if normalized_value in {'null', 'none', 'n/a', ''}:
        return None

    return date.fromisoformat(normalized_value)


def normalize_due_date_text(text: str, reference_date: date) -> date | None:
    normalized_text = text.strip()
    if not normalized_text:
        return None

    deterministic_match = parse_relative_due_date(normalized_text, reference_date)
    if deterministic_match is not None:
        return deterministic_match

    system_prompt = (
        'You convert a spoken phrase (English or Arabic) into a calendar date. '
        'You are given a reference date. '
        'Respond ONLY with a JSON object {"due_date": "YYYY-MM-DD"|null}. '
        'Use null if the phrase does not express a clear date.'
    )
    user_prompt = (
        f'Reference date: {reference_date.isoformat()}\n'
        f'Phrase: {normalized_text}'
    )
    payload = _chat_json(system_prompt, user_prompt, TaskExtractorServiceError)
    return normalize_due_date(payload.get('due_date'))


def parse_relative_due_date(text: str, reference_date: date) -> date | None:
    normalized = re.sub(r'\s+', ' ', text.strip().lower())
    if not normalized:
        return None

    if normalized in {'today', 'tonight', 'todays', 'اليوم', 'النهارده', 'النهاردة'}:
        return reference_date

    if normalized in {'tomorrow', 'tmr', 'tmrw', 'بكرة', 'بكره'}:
        return reference_date + timedelta(days=1)

    if normalized in {'day after tomorrow', 'after tomorrow', 'بعد بكرة', 'بعد بكره'}:
        return reference_date + timedelta(days=2)

    if normalized in {'next week', 'sometime next week', 'الاسبوع الجاي', 'الأسبوع الجاي'}:
        return reference_date + timedelta(days=7)

    if normalized in {'this week', 'end of this week', 'by the end of this week', 'نهاية الاسبوع', 'نهاية الأسبوع'}:
        days_until_sunday = 6 - reference_date.weekday()
        return reference_date + timedelta(days=max(days_until_sunday, 0))

    weekdays = {
        'monday': 0,
        'mon': 0,
        'monday.': 0,
        'الاثنين': 0,
        'الإثنين': 0,
        'tuesday': 1,
        'tue': 1,
        'tues': 1,
        'الثلاثاء': 1,
        'wednesday': 2,
        'wed': 2,
        'الأربعاء': 2,
        'الاربعاء': 2,
        'thursday': 3,
        'thu': 3,
        'thur': 3,
        'thurs': 3,
        'الخميس': 3,
        'friday': 4,
        'fri': 4,
        'الجمعة': 4,
        'الجمعه': 4,
        'saturday': 5,
        'sat': 5,
        'السبت': 5,
        'sunday': 6,
        'sun': 6,
        'الأحد': 6,
        'الاحد': 6,
    }
    for label, weekday in weekdays.items():
        if normalized == label or normalized == f'next {label}' or normalized == f'coming {label}':
            days_ahead = (weekday - reference_date.weekday()) % 7
            if days_ahead == 0:
                days_ahead = 7
            return reference_date + timedelta(days=days_ahead)

    return None
