import json

from fastapi import FastAPI, HTTPException
from openai import OpenAI

from .config import get_settings
from .schemas import (
    DueDateNormalizationRequest,
    DueDateNormalizationResponse,
    TaskExtractionRequest,
    TaskExtractionResponse,
)

settings = get_settings()
app = FastAPI(title=settings.app_name)
client = OpenAI(api_key=settings.openai_api_key) if settings.openai_api_key else None

PROMPT = '''You convert meeting notes or voice transcripts into actionable tasks.
Rules:
- Extract only concrete actionable tasks.
- Keep titles short and imperative.
- Always return title and description in English, even if the transcript is Arabic.
- Use an empty list if no real tasks exist.
- Priority must be one of: low, medium, high.
- due_date must be YYYY-MM-DD or null.
- Understand transcripts in Arabic or English.
- If a task is clearly assigned to a person and that person matches one of the available usernames, set assignee_username to the exact username from the provided list.
- assignee_username must always use English letters, lowercase, and no spaces.
- Never return Arabic script in assignee_username.
- If no assignee is mentioned, set assignee_username to an empty string.
'''

TASK_SCHEMA = {
    'type': 'object',
    'properties': {
        'tasks': {
            'type': 'array',
            'items': {
                'type': 'object',
                'properties': {
                    'title': {'type': 'string'},
                    'description': {'type': 'string'},
                    'priority': {'type': 'string', 'enum': ['low', 'medium', 'high']},
                    'due_date': {'type': ['string', 'null']},
                    'assignee_username': {'type': 'string'},
                },
                'required': ['title', 'description', 'priority', 'due_date', 'assignee_username'],
                'additionalProperties': False,
            },
        },
    },
    'required': ['tasks'],
    'additionalProperties': False,
}

DUE_DATE_PROMPT = '''You extract a due date from a short user reply.
Rules:
- Return due_date as YYYY-MM-DD when a concrete date can be determined.
- Return null when the text does not clearly contain a due date.
- Understand Arabic and English.
- If the user gives a relative date like tomorrow, next Thursday, or end of this week, resolve it using the provided reference date.
- Return only valid calendar dates.
'''

DUE_DATE_SCHEMA = {
    'type': 'object',
    'properties': {
        'due_date': {'type': ['string', 'null']},
    },
    'required': ['due_date'],
    'additionalProperties': False,
}


@app.get('/health')
def healthcheck() -> dict:
    return {'status': 'ok'}


@app.post('/extract-tasks', response_model=TaskExtractionResponse)
def extract_tasks(payload: TaskExtractionRequest) -> TaskExtractionResponse:
    if client is None:
        raise HTTPException(status_code=500, detail='OPENAI_API_KEY is not configured.')

    try:
        response = client.responses.create(
            model=settings.openai_model,
            input=(
                f'{PROMPT}\n'
                f'Available usernames: {", ".join(payload.available_usernames) or "none"}\n'
                f'Transcript:\n{payload.transcript}'
            ),
            text={
                'format': {
                    'type': 'json_schema',
                    'name': 'extracted_tasks',
                    'schema': TASK_SCHEMA,
                    'strict': True,
                }
            },
        )
        if not response.output_text:
            raise ValueError('The model returned an empty response.')

        data = json.loads(response.output_text)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f'Task extraction model error: {exc}') from exc

    return TaskExtractionResponse(**data)


@app.post('/normalize-due-date', response_model=DueDateNormalizationResponse)
def normalize_due_date(payload: DueDateNormalizationRequest) -> DueDateNormalizationResponse:
    if client is None:
        raise HTTPException(status_code=500, detail='OPENAI_API_KEY is not configured.')

    try:
        response = client.responses.create(
            model=settings.openai_model,
            input=(
                f'{DUE_DATE_PROMPT}\n'
                f'Reference date: {payload.reference_date}\n'
                f'User reply:\n{payload.text}'
            ),
            text={
                'format': {
                    'type': 'json_schema',
                    'name': 'normalized_due_date',
                    'schema': DUE_DATE_SCHEMA,
                    'strict': True,
                }
            },
        )
        if not response.output_text:
            raise ValueError('The model returned an empty response.')

        data = json.loads(response.output_text)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f'Due date normalization model error: {exc}') from exc

    return DueDateNormalizationResponse(**data)
