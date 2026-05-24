from __future__ import annotations

from decimal import Decimal
from datetime import date, timedelta
from pathlib import Path
import re

import requests
from django.conf import settings


class TranscriberServiceError(Exception):
    pass


class TaskExtractorServiceError(Exception):
    pass


def transcribe_file(file_path: Path, language: str | None = None) -> dict:
    endpoint = f"{settings.TRANSCRIBER_SERVICE_URL.rstrip('/')}/transcribe"
    with file_path.open('rb') as audio_file:
        data = {}
        if language:
            data['language'] = language
        response = requests.post(
            endpoint,
            files={'file': (file_path.name, audio_file, 'application/octet-stream')},
            data=data,
            timeout=180,
        )
    if response.status_code >= 400:
        raise TranscriberServiceError(response.text)
    return response.json()


def normalize_duration(value: float | int | None) -> Decimal | None:
    if value is None:
        return None
    return Decimal(str(round(float(value), 2)))


def extract_tasks(transcript: str, available_usernames: list[str] | None = None) -> list[dict]:
    endpoint = f"{settings.TASK_EXTRACTOR_SERVICE_URL.rstrip('/')}/extract-tasks"
    response = requests.post(
        endpoint,
        json={
            'transcript': transcript,
            'available_usernames': available_usernames or [],
        },
        timeout=60,
    )
    if response.status_code >= 400:
        raise TaskExtractorServiceError(response.text)
    return response.json().get('tasks', [])


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

    endpoint = f"{settings.TASK_EXTRACTOR_SERVICE_URL.rstrip('/')}/normalize-due-date"
    response = requests.post(
        endpoint,
        json={
            'text': normalized_text,
            'reference_date': reference_date.isoformat(),
        },
        timeout=60,
    )
    if response.status_code >= 400:
        raise TaskExtractorServiceError(response.text)

    value = response.json().get('due_date')
    return normalize_due_date(value)


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
