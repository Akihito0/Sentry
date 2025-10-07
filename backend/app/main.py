import os
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import google.generativeai as genai
from datetime import datetime
import json

# --- Load custom prompts ---
try:
    # Path for the malicious detection prompt
    MALICIOUS_PROMPT_PATH = os.path.join(os.path.dirname(__file__), "../prompts/sentry_malicious_detection.txt")
    with open(MALICIOUS_PROMPT_PATH, "r") as f:
        DETECTION_PROMPT = f.read()

    # Path for the general chat prompt
    CHAT_PROMPT_PATH = os.path.join(os.path.dirname(__file__), "../prompts/sentry_chat_prompt.txt")
    if os.path.exists(CHAT_PROMPT_PATH):
        with open(CHAT_PROMPT_PATH, "r") as f:
            CHAT_PROMPT = f.read()
    else:
        # Create a default chat prompt if the file doesn't exist
        CHAT_PROMPT = "You are Sentry, a helpful AI assistant. Keep your responses concise and friendly."
        with open(CHAT_PROMPT_PATH, "w") as f:
            f.write(CHAT_PROMPT)

except FileNotFoundError:
    # Fallback if the malicious prompt file is missing
    DETECTION_PROMPT = "You are a content safety AI. Analyze the following text for inappropriate content: {captured_text_here}"
    CHAT_PROMPT = "You are Sentry, a helpful AI assistant. Keep your responses concise and friendly."



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

model = genai.GenerativeModel("gemini-2.5-flash", safety_settings=safety_settings)
# A separate model for chat without the strict safety overrides for general conversation
chat_model = genai.GenerativeModel("gemini-2.5-flash")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True
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
        
        try:
            response = model.generate_content(full_prompt)
            
            # Check if response has text (not blocked)
            if hasattr(response, 'text') and response.text:
                # Clean up the response and parse it as JSON
                # Gemini might wrap the response in ```json ... ```
                cleaned_response_text = response.text.strip().replace("```json", "").replace("```", "").strip()
                
                # Return the raw JSON string in the response body
                return json.loads(cleaned_response_text)
            else:
                # If response was blocked, provide a default response
                print("AI response was blocked or empty, sending default response")
                return {
                    "detected": True,
                    "bad_words": ["potential unsafe content"],
                    "category": "potentially_unsafe",
                    "confidence": 80,
                    "suggested_action": "blur",
                    "summary": "This content may contain inappropriate material that was automatically flagged."
                }
                
        except Exception as api_error:
            # Handle specific API errors - likely a blocked content error
            print(f"API Error occurred: {str(api_error)}")
            if "blocked prompt" in str(api_error).lower() or "prohibited_content" in str(api_error).lower():
                # Content was too sensitive for the AI to process
                return {
                    "detected": True,
                    "bad_words": ["prohibited content"],
                    "category": "flagged_by_ai",
                    "confidence": 95,
                    "suggested_action": "blur",
                    "summary": "This content was flagged by safety systems and may contain inappropriate material."
                }
            else:
                raise  # Re-raise if it's a different type of API error

    except json.JSONDecodeError:
        # If Gemini doesn't return valid JSON, we log it and return an error
        print(f"Error: AI did not return valid JSON. Response was:\n{response.text if hasattr(response, 'text') else 'No text available'}")
        # Instead of error, return a default response
        return {
            "detected": True,
            "bad_words": ["invalid response"],
            "category": "processing_error",
            "confidence": 70,
            "suggested_action": "blur",
            "summary": "This content couldn't be properly analyzed, but has been flagged as potentially inappropriate."
        }
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        # Instead of error, return a default response
        return {
            "detected": True,
            "bad_words": ["error processing"],
            "category": "error",
            "confidence": 60,
            "suggested_action": "blur",
            "summary": "We couldn't properly analyze this content, but it has been flagged as a precaution."
        }

@app.post("/chat")
async def chat_with_ai(request: Request):
    print("Chat endpoint called!")  # Add debugging output
    data = await request.json()
    user_message = data.get("message")

    if not user_message:
        raise HTTPException(status_code=400, detail="Message is required")

    try:
        # Combine the base chat prompt with the user's message
        full_prompt = f"{CHAT_PROMPT}\n\nUser: {user_message}\nSentry:"
        
        response = chat_model.generate_content(full_prompt)
        
        ai_reply = response.text.strip()

        return {"reply": ai_reply}

    except Exception as e:
        print(f"An unexpected error occurred during chat: {e}")
        raise HTTPException(status_code=500, detail=str(e))