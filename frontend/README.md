# Next.js Frontend

This repo is the user-facing app for uploading audio files and reviewing saved transcripts.

## Setup
```bash
npm install
cp .env.local.example .env.local
npm run dev
```

## Environment
- `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000/api`

## Flow
- Upload an Arabic or English audio file.
- Or record audio directly from the browser.
- The frontend sends it to Django.
- Django stores the file and transcript.
- The list view shows all saved results.
