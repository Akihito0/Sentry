import os
import google.generativeai as genai
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from .services import ai_service
from dotenv import load_dotenv

# --- The Ultimate Bulletproof .env Loader ---

# 1. Get the absolute path of the directory where this file (main.py) is located.
#    Example: C:/Users/Noah/SENTRY/fastapi_server
current_dir = os.path.dirname(os.path.abspath(__file__))

# 2. Go one level up to get the root project directory.
#    Example: C:/Users/Noah/SENTRY
project_root = os.path.dirname(current_dir)

# 3. Join the root path with the '.env' filename to get the absolute path to the .env file.
#    Example: C:/Users/Noah/SENTRY/.env
dotenv_path = os.path.join(project_root, '.env')

# 4. Explicitly load the .env file from that exact path.
#    This is not a search; it's a direct command.
load_dotenv(dotenv_path=dotenv_path)

# --- Configuration & Setup ---
API_KEY = os.getenv("GEMINI_API_KEY")

# This check will now pass.
if not API_KEY:
    # If it fails now, it means the .env file is missing or the key name is wrong.
    raise ValueError(f"CRITICAL: GEMINI_API_KEY not found in {dotenv_path}")

genai.configure(api_key=API_KEY)
GEMINI_MODEL = genai.GenerativeModel('gemini-pro')

# Load the prompt template from the file
try:
    prompt_path = os.path.join(current_dir, 'services', 'content_analysis.prompt')
    with open(prompt_path, "r") as f:
        PROMPT_TEMPLATE = f.read().replace('{{page_text}}', '{page_text}')
except FileNotFoundError:
    raise RuntimeError("CRITICAL: content_analysis.prompt file not found.")

app = FastAPI()

# --- Middleware for CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Pydantic Models for Request/Response ---
class AnalysisRequest(BaseModel):
    text: str = Field(..., min_length=20)

class AnalysisResult(BaseModel):
    is_safe: bool
    reason: str

class AnalysisResponse(BaseModel):
    status: str
    result: AnalysisResult | None = None
    message: str | None = None

# --- API Endpoints ---
@app.get("/")
def read_root():
    return {"message": "Sentry AI Server is running."}

@app.post("/analyze", response_model=AnalysisResponse)
async def analyze_content(request: AnalysisRequest):
    page_text = request.text
    try:
        result = ai_service.get_ai_response(
            model=GEMINI_MODEL,
            prompt_template=PROMPT_TEMPLATE,
            page_text=page_text
        )
        return AnalysisResponse(status="complete", result=result)

    except Exception as e:
        print(f"ERROR in /analyze endpoint: {e}")
        return AnalysisResponse(status="error", message=f"Server error: {str(e)}")