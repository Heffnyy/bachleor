from pydantic import BaseModel, Field


class TaskItem(BaseModel):
    title: str = Field(..., min_length=1)
    description: str = ''
    priority: str = 'medium'
    due_date: str | None = None
    assignee_username: str = ''


class TaskExtractionRequest(BaseModel):
    transcript: str = Field(..., min_length=1)
    available_usernames: list[str] = Field(default_factory=list)


class TaskExtractionResponse(BaseModel):
    tasks: list[TaskItem]


class DueDateNormalizationRequest(BaseModel):
    text: str = Field(..., min_length=1)
    reference_date: str = Field(..., min_length=10, max_length=10)


class DueDateNormalizationResponse(BaseModel):
    due_date: str | None = None
