import os
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import google.generativeai as genai
from datetime import datetime
import json

# --- Load custom malicious detection prompt ---
try:
    PROMPT_PATH = os.path.join(os.path.dirname(__file__), "../prompts/sentry_malicious_detection.txt")
    with open(PROMPT_PATH, "r") as f:
        DETECTION_PROMPT = f.read()
except FileNotFoundError:
    # Fallback if the prompt file is missing
    DETECTION_PROMPT = "You are a content safety AI. Analyze the following text for inappropriate content: {captured_text_here}"


load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if not GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY environment variable is not set")

genai.configure(api_key=GEMINI_API_KEY)

# Configuration for safety settings to allow analysis of potentially harmful content
# Without this, Gemini might refuse to process the text at all.
safety_settings = [
    {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
    {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
    {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
    {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
]

model = genai.GenerativeModel("gemini-1.5-flash", safety_settings=safety_settings)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def read_root():
    return {"message": "Sentry backend is running"}

@app.post("/ask")
async def ask_ai(request: Request):
    data = await request.json()
    # The extension will send 'content', not 'prompt'
    screen_text = data.get("content")

    if not screen_text:
        raise HTTPException(status_code=400, detail="Content for analysis is required")

    try:
        current_time = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')
        
        # Construct the full prompt by filling in our template
        full_prompt = DETECTION_PROMPT.replace("{current_date_time}", current_time).replace("{captured_text_here}", screen_text)
        
        response = model.generate_content(full_prompt)

        # Clean up the response and parse it as JSON
        # Gemini might wrap the response in ```json ... ```
        cleaned_response_text = response.text.strip().replace("```json", "").replace("```", "").strip()
        
        # Return the raw JSON string in the response body
        return json.loads(cleaned_response_text)

    except json.JSONDecodeError:
        # If Gemini doesn't return valid JSON, we log it and return an error
        print(f"Error: AI did not return valid JSON. Response was:\n{response.text}")
        raise HTTPException(status_code=500, detail="AI response was not in the expected JSON format.")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        raise HTTPException(status_code=500, detail=str(e))