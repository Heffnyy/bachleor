# Project Overview — AI Transcription / "Voice To Task" System

> This document is generated from a read of the codebase. Where something is
> inferred or uncertain, it is flagged explicitly.

---

## 1. What it is

This is a **voice-to-task workflow system** for an organization with a hierarchy
(chain of command). A user records a spoken message in Arabic or English, the
system transcribes it, and an AI model turns the transcript into concrete tasks
that are automatically assigned to people the speaker is allowed to command.
Assignees track task status, send notes/delay requests back, and superiors can
oversee, reassign, or delete tasks down their branch of the org chart.

It is aimed at managers/team leaders who delegate work verbally and want it
captured as structured, assigned, trackable tasks rather than written by hand.

The product is branded **"Voice To Task"** in user-facing strings (emails, UI).

---

## 2. Tech stack

**Backend API (`backend/`)**
- Python, **Django 5.1.4** + **Django REST Framework 3.15.2**
- `django-cors-headers` for CORS
- Token authentication (DRF `authtoken`)
- `dj-database-url` + `psycopg[binary]` (Postgres driver available) — but **currently running on SQLite** (see §8)
- `python-dotenv` for env loading
- Email via Django `send_mail` (SMTP, or console backend when unconfigured)

**Transcription microservice (`transcriber/`)**
- **FastAPI 0.115.6** + Uvicorn
- **`faster-whisper` 1.1.1** (Whisper model, default size `small`, CPU, int8)
- Requires **ffmpeg** installed on the host

**Task-extraction microservice (`task-extractor/`)**
- **FastAPI** + Uvicorn
- **OpenAI Python SDK 1.75.0**, default model `gpt-4o-mini`, using the
  Responses API with strict JSON-schema structured output

**Frontend (`frontend/`)**
- **Next.js 15.1.4** (App Router) + **React 19**
- **TypeScript 5.7**
- No UI component library or state library — plain React with `fetch`; styling
  via a single `globals.css`

**Database:** PostgreSQL-ready, **SQLite in current local state**.

---

## 3. Architecture

Four independent services that talk over HTTP:

```
  Browser
    │  (NEXT_PUBLIC_API_BASE_URL, Token auth)
    ▼
  Next.js frontend  ──────────►  Django backend (REST API, :8000)
   (:3000)                          │   │
                                    │   └──► Transcriber service (:8001)  POST /transcribe
                                    │            (faster-whisper + ffmpeg)
                                    └──────► Task-extractor service (:8002)
                                                 POST /extract-tasks
                                                 POST /normalize-due-date
                                                 (OpenAI)
                          Django ──► SMTP / console (email notifications)
                          Django ──► DB (SQLite now / Postgres-ready)
```

**Core upload flow** (`TranscriptionViewSet.create`, `backend/transcriptions/views.py`):
1. Frontend `POST`s the audio file (+ optional `language` = `ar`/`en`) to
   `/api/transcriptions/` as multipart form data.
2. Django saves the file (`media/audio/`) and a `Transcription` row (`pending`).
3. Django calls the **transcriber** service synchronously → gets text, detected
   language, duration. Status → `completed`.
4. If there's a transcript, Django calls the **task-extractor** service, passing
   the transcript plus the list of all usernames, and gets back structured tasks.
5. For each task, Django resolves the named assignee to a real `User` and
   **enforces the chain of command** (`can_assign`): if the speaker may not
   command that person, the task is created unassigned and a warning is recorded.
6. The full transcript + tasks are serialized back to the frontend.

> **Note:** This is all **synchronous** inside the HTTP request — there is no
> task queue/worker. A long recording blocks the request (transcriber timeout is
> 180s, extractor 60s).

**Due-date clarification flow** (`TaskViewSet.clarify`): a reviewer can attach a
spoken reply to a task; it's transcribed, then a due date is parsed —
deterministically first (`parse_relative_due_date`, handles English + Arabic
"tomorrow", weekdays, etc.) and only falling back to the OpenAI
`/normalize-due-date` endpoint if needed.

---

## 4. Project structure

| Path | What lives here |
|------|-----------------|
| `backend/` | Django REST API — the central hub. |
| `backend/backend/` | Django project config (`settings.py`, `urls.py`, wsgi/asgi). |
| `backend/transcriptions/` | The single Django app: models, views, serializers, services, hierarchy, notifications, admin, migrations. |
| `backend/media/audio/` | Uploaded audio files (served via `MEDIA_URL`). |
| `transcriber/` | Standalone FastAPI service wrapping faster-whisper. |
| `transcriber/app/` | `main.py` (routes), `engine.py` (Whisper), `config.py`, `schemas.py`. |
| `task-extractor/` | Standalone FastAPI service wrapping OpenAI. |
| `task-extractor/app/` | `main.py` (prompts + routes), `config.py`, `schemas.py`. |
| `frontend/` | Next.js app. |
| `frontend/app/` | App Router pages: `page.tsx` → `client-page.tsx` (main app), `admin/page.tsx`, `layout.tsx`, `globals.css`. |
| `frontend/components/` | `upload-form`, `transcript-list`, `task-countdown`, `admin-panel`. |
| `frontend/lib/api.ts` | Typed API client + all shared TS types. |

> Each Python service has its own `.venv/` and `requirements.txt` and is meant to
> be run separately. The root `README.md` calls them "four separate repos" living
> in one workspace.

---

## 5. Key files

**Backend**
- `backend/backend/settings.py` — config, DB selection, CORS, DRF auth, service
  URLs, email setup.
- `backend/transcriptions/models.py` — all data models (see §6).
- `backend/transcriptions/views.py` — all API logic: auth, account/OTP, dashboard,
  transcription upload pipeline, task actions, admin approval. (~920 lines, the
  largest backend file.)
- `backend/transcriptions/services.py` — HTTP clients for the two AI services +
  due-date normalization helpers.
- `backend/transcriptions/hierarchy.py` — chain-of-command logic: who can assign
  to / oversee whom (`can_assign`, `is_strict_ancestor`, `get_subordinate_ids`,
  `can_oversee_task`).
- `backend/transcriptions/notifications.py` — all transactional emails.
- `backend/transcriptions/serializers.py` — DRF serializers + validation.
- `backend/transcriptions/urls.py` — route table (router + explicit auth/admin paths).

**Transcriber service**
- `transcriber/app/main.py` — `/transcribe`, `/health`.
- `transcriber/app/engine.py` — `WhisperEngine`, the actual transcription.

**Task-extractor service**
- `task-extractor/app/main.py` — `/extract-tasks`, `/normalize-due-date`, the
  OpenAI prompts and JSON schemas.

**Frontend**
- `frontend/lib/api.ts` — every backend call + all TypeScript types; the best
  single file to understand the API surface.
- `frontend/app/client-page.tsx` — the main authenticated SPA (login/register,
  dashboard, tasks). ~54 KB, the largest frontend file.
- `frontend/components/admin-panel.tsx` — admin approval/role-management UI.

---

## 6. Data model

All models live in `backend/transcriptions/models.py`. They hang off Django's
built-in `auth.User`.

**`UserProfile`** (one-to-one with `User`)
- `role` — one of: `admin`, `manager`, `senior_team_leader`, `junior_team_leader`,
  `employee`, `outsource_staff`. Each role has a numeric **rank** (admin 100 …
  outsource 5) used for command authority.
- `manager` — FK to another `User` (their direct superior); forms the org tree.
- `requested_role` / `requested_manager_name` — what the user applied for at
  registration (before admin approval).
- `status` — `pending` → `active` / `rejected` / `permanently_rejected`. Drives
  whether login is allowed.
- `rejection_reason`.

**`AccountChangeOTP`** (FK → User)
- A 6-digit, hashed, 10-minute one-time code (max 5 attempts) required before a
  user can edit their own account details. Issues a `verification_token` once
  verified.

**`Transcription`** (FK `owner` → User)
- `original_file` (audio), `original_filename`, `detected_language`,
  `transcript`, `duration_seconds`, `status` (`pending`/`completed`/`failed`),
  `error_message`. Custom `delete()` also removes the stored audio file.

**`Task`** (FK `transcription` → Transcription)
- `title`, `description`, `priority` (`low`/`medium`/`high`).
- `status` — `delivered` / `in_progress` / `done`.
- `assigned_to` (FK User) + `assigned_to_name` (free-text fallback when the
  name couldn't be resolved to a user).
- `assigned_from` (FK User) — who delegated it.
- `due_date`, `is_reviewed` (has the sender confirmed/sent it), `is_completed`,
  `completed_at`.

**`TaskNote`** (FK `task` → Task, FK `author` → User)
- A message from assignee back to sender: `kind` = `problem` / `delay` / `note`,
  `message`, optional `requested_due_date`.

**Relationships:** `User 1—1 UserProfile`; `UserProfile.manager → User` (org tree);
`User 1—* Transcription 1—* Task 1—* TaskNote`; `Task.assigned_to` / `assigned_from`
→ `User`.

---

## 7. How to run it

Authoritative steps are in the root `README.md`. **All four services run
separately, in this order.** Each Python service uses its own venv.

**Prerequisites:** Python 3.12, Node.js, **ffmpeg installed**, and an **OpenAI
API key** for the task-extractor.

**1. Transcriber (`:8001`)**
```bash
cd transcriber
python3.12 -m venv .venv && source .venv/bin/activate
pip install -U pip setuptools wheel && pip install -r requirements.txt
cp .env.example .env
python -m uvicorn app.main:app --reload --port 8001
```

**2. Task-extractor (`:8002`)**
```bash
cd task-extractor
python3.12 -m venv .venv && source .venv/bin/activate
pip install -U pip setuptools wheel && pip install -r requirements.txt
cp .env.example .env          # then set OPENAI_API_KEY in .env
python -m uvicorn app.main:app --reload --port 8002
```

**3. Django backend (`:8000`)**
```bash
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -U pip setuptools wheel && pip install -r requirements.txt
cp .env.example .env
python manage.py migrate
python manage.py runserver 8000
```
(You'll also want `python manage.py createsuperuser` to get an admin who can
approve registrations — a superuser is auto-treated as admin.)

**4. Frontend (`:3000`)**
```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

**Default URLs:** frontend `:3000`, backend `:8000`, transcriber `:8001`,
extractor `:8002`.

**Key environment variables**
| Service | Var | Purpose |
|---------|-----|---------|
| backend | `DJANGO_SECRET_KEY`, `DJANGO_DEBUG`, `DJANGO_ALLOWED_HOSTS` | Django basics |
| backend | `DATABASE_URL` | If set → Postgres (SSL required); if blank → SQLite |
| backend | `CORS_ALLOWED_ORIGINS` | Frontend origin |
| backend | `TRANSCRIBER_SERVICE_URL`, `TASK_EXTRACTOR_SERVICE_URL` | Microservice locations |
| backend | `EMAIL_HOST` + `EMAIL_HOST_USER` + `EMAIL_HOST_PASSWORD` | Real SMTP; blank → email printed to console log |
| backend | `FRONTEND_BASE_URL` | Used in email links |
| transcriber | `WHISPER_MODEL_SIZE`, `WHISPER_COMPUTE_TYPE`, `WHISPER_DEVICE`, `WHISPER_BEAM_SIZE` | Whisper tuning |
| task-extractor | `OPENAI_API_KEY`, `OPENAI_MODEL` | OpenAI access |
| frontend | `NEXT_PUBLIC_API_BASE_URL` | Backend API base (default `http://127.0.0.1:8000/api`) |

---

## 8. Current state & known issues

**Current state**
- Single git commit ("Initial commit"); active uncommitted work in progress —
  the working tree has many modified/new files (UserProfile/roles, OTP,
  task status + notes, admin panel, hierarchy/notifications modules) that look
  like a recently-added "org hierarchy + admin approval" feature layered on top
  of the original transcription app.
- **Database is on local SQLite right now.** `DATABASE_URL` is unset/commented
  in `backend/.env`, so settings fall back to `db.sqlite3`. The Postgres/Supabase
  path is paused. (Confirmed by project memory + `settings.py` logic.)

**Fragile / things to be aware of**
- **Synchronous AI pipeline, no queue.** Transcription and task extraction run
  inside the upload HTTP request. Large files can hit the 180s/60s `requests`
  timeouts and block a worker. No retry/background processing.
- **Tight service coupling at runtime.** If the transcriber service is down the
  upload fails (`failed`); if the extractor is down the transcript still saves
  but with an error message and no tasks.
- **`AUTH_PASSWORD_VALIDATORS = []`** — password strength is not enforced.
- **`SECRET_KEY` defaults to `django-insecure-change-me`** and `DEBUG` defaults
  to `true` — fine for dev, must be set for any deployment.
- **No automated tests** found in any service.
- **Assignee name resolution is heuristic** (`resolve_assigned_user` /
  `normalize_username_value`): it strips accents/spaces and tries to match the
  AI-suggested name against usernames and first/last names. Iterates over all
  users in Python (O(n) per task) — fine at small scale, not for large user bases.
- **OpenAI key required** for task extraction and AI due-date fallback; without
  it those endpoints return 500/502 (deterministic relative-date parsing still
  works without it).
- **No pagination** on dashboard/task list queries; everything in the user's
  subtree is loaded at once.
- The root `README.md` has a copy/paste artifact in the frontend run block
  (stray quote characters around the commands) — cosmetic.
- A deleted file `frontend/app/client-page 2.tsx` appears in git status (an old
  duplicate being removed).

> **Unverified / not deeply read:** the full contents of `client-page.tsx` and
> the admin React components (behavior described here is inferred from `api.ts`,
> the backend endpoints, and file roles, not a line-by-line read of the UI).
> `serializers.py` and `admin.py` were not read in full — model details above
> come from `models.py`, the source of truth.
