# Sentry Backend

This backend uses FastAPI and integrates Gemini AI.

## Structure

- `app/` - FastAPI application code
- `prompts/` - AI prompt files (.txt)
- `requirements.txt` - Python dependencies

## Setup

1. Install dependencies:

    ```bash
    pip install -r requirements.txt
    ```

2. Run server:

    ```bash
    uvicorn app.main:app --reload
    ```

## Prompts

All AI prompt files are stored in the `prompts/` folder and use the `.txt` extension.
