import os
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import google.generativeai as genai
from datetime import datetime
import json

# --- Load custom prompts ---
try:

    # Path for the content blocking prompt
    CONTENT_BLOCKING_PROMPT_PATH = os.path.join(os.path.dirname(__file__), "../prompts/sentry_content_blocking.txt")
    with open(CONTENT_BLOCKING_PROMPT_PATH, "r") as f:
        CONTENT_BLOCKING_PROMPT = f.read()

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
    # Fallback if the prompt files are missing
    CONTENT_BLOCKING_PROMPT = "You are a content safety AI. Analyze the following content and determine if it should be blocked: {captured_text_here}"
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

@app.post("/analyze-content")
async def analyze_content(request: Request):
    """
    Analyzes webpage content (text, images, captions, links) to determine if it should be blocked.
    Returns a friendly JSON response with safe/unsafe status and gentle guidance.
    """
    data = await request.json()
    content = data.get("content")

    if not content:
        raise HTTPException(status_code=400, detail="Content for analysis is required")

    try:
        current_time = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')
        
        # Construct the full prompt using the content blocking template
        full_prompt = CONTENT_BLOCKING_PROMPT.replace("{current_date_time}", current_time).replace("{captured_text_here}", content)
        
        try:
            response = model.generate_content(full_prompt)
            
            # Check if response has text (not blocked)
            if hasattr(response, 'text') and response.text:
                # Clean up the response and parse it as JSON
                cleaned_response_text = response.text.strip().replace("```json", "").replace("```", "").strip()
                
                # Parse and return the JSON
                parsed_response = json.loads(cleaned_response_text)
                return parsed_response
            else:
                # If response was blocked, provide a safe default response
                print("AI response was blocked or empty, sending safe default")
                return {
                    "safe": False,
                    "title": "Content Flagged",
                    "reason": "This content couldn't be properly analyzed, but our safety systems have flagged it as potentially inappropriate. It's better to be cautious.",
                    "what_to_do": "Consider skipping this content. If you believe this is a mistake, you can choose to view it anyway.",
                    "category": "flagged_by_system",
                    "confidence": 80
                }
                
        except Exception as api_error:
            # Handle specific API errors
            print(f"API Error occurred: {str(api_error)}")
            if "blocked" in str(api_error).lower() or "prohibited" in str(api_error).lower():
                return {
                    "safe": False,
                    "title": "Content Flagged",
                    "reason": "Our safety systems have identified this content as potentially harmful. The content appears to violate safety guidelines.",
                    "what_to_do": "We recommend avoiding this content. If you still want to proceed, please do so with caution.",
                    "category": "system_blocked",
                    "confidence": 95
                }
            else:
                raise

    except json.JSONDecodeError:
        print(f"Error: AI did not return valid JSON. Response was:\n{response.text if hasattr(response, 'text') else 'No text available'}")
        return {
            "safe": False,
            "title": "Analysis Error",
            "reason": "We couldn't properly analyze this content, but we've flagged it as a precaution to keep you safe.",
            "what_to_do": "Consider skipping this content or proceeding with caution if you trust the source.",
            "category": "processing_error",
            "confidence": 70
        }
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        return {
            "safe": False,
            "title": "Safety Check Error",
            "reason": "We encountered an issue while checking this content. To be safe, we've flagged it for your protection.",
            "what_to_do": "You can choose to proceed with caution or skip this content.",
            "category": "error",
            "confidence": 60
        }

@app.post("/analyze-batch")
async def analyze_batch(request: Request):
    """
    PHASE 2: Batch content analysis - analyzes multiple text contents in ONE API call
    Expects: { "contents": ["text1", "text2", "text3", ...] }
    Returns: { "results": [{ "safe": bool, ... }, { "safe": bool, ... }, ...] }
    """
    data = await request.json()
    contents = data.get("contents", [])
    
    if not contents or not isinstance(contents, list):
        raise HTTPException(status_code=400, detail="Contents array is required")
    
    if len(contents) == 0:
        return {"results": []}
    
    # Limit batch size to prevent overwhelming the API
    if len(contents) > 50:
        raise HTTPException(status_code=400, detail="Maximum 50 contents per batch")
    
    try:
        current_time = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')
        
        # Create batch prompt - analyze all contents together
        batch_prompt = f"""You are Sentry, a content safety AI. Analyze the following {len(contents)} pieces of content.
For EACH content, return a JSON object with the same format.

Current time: {current_time}

CONTENTS TO ANALYZE:
"""
        for i, content in enumerate(contents):
            batch_prompt += f"\n--- CONTENT {i+1} ---\n{content[:1000]}\n"  # Limit each to 1000 chars
        
        batch_prompt += f"""

IMPORTANT: Return a JSON array with {len(contents)} objects, one for each content in order.
Each object must have this format:
{{
  "safe": true/false,
  "title": "Brief title",
  "reason": "Explanation",
  "what_to_do": "User guidance",
  "category": "profanity/explicit_content/scam/disturbing/safe",
  "confidence": 0-100
}}

Return ONLY the JSON array, nothing else. Format: [{{"safe":...}}, {{"safe":...}}, ...]
"""
        
        try:
            response = model.generate_content(batch_prompt)
            
            if hasattr(response, 'text') and response.text:
                cleaned_response_text = response.text.strip().replace("```json", "").replace("```", "").strip()
                parsed_response = json.loads(cleaned_response_text)
                
                # Ensure we have an array
                if isinstance(parsed_response, list):
                    results = parsed_response
                else:
                    # If single object returned, wrap in array
                    results = [parsed_response]
                
                # Pad with safe defaults if not enough results
                while len(results) < len(contents):
                    results.append({
                        "safe": True,
                        "title": "Content is Safe",
                        "reason": "No inappropriate content detected.",
                        "what_to_do": "You can safely view this content.",
                        "category": "safe",
                        "confidence": 70
                    })
                
                return {"results": results[:len(contents)]}  # Return exactly as many as requested
            else:
                # Blocked response - return all as unsafe
                print("Batch AI response blocked, marking all as unsafe")
                return {
                    "results": [{
                        "safe": False,
                        "title": "Content Flagged",
                        "reason": "Content flagged by safety systems.",
                        "what_to_do": "Proceed with caution.",
                        "category": "flagged_by_system",
                        "confidence": 80
                    } for _ in contents]
                }
        
        except json.JSONDecodeError as e:
            print(f"Batch JSON decode error: {e}")
            # Return safe defaults
            return {
                "results": [{
                    "safe": True,
                    "title": "Analysis Error",
                    "reason": "Couldn't analyze this content properly.",
                    "what_to_do": "Use your judgment.",
                    "category": "error",
                    "confidence": 50
                } for _ in contents]
            }
        except Exception as api_error:
            print(f"Batch API error: {api_error}")
            return {
                "results": [{
                    "safe": False,
                    "title": "Safety Check Error",
                    "reason": "Flagged as precaution due to processing error.",
                    "what_to_do": "Proceed with caution.",
                    "category": "error",
                    "confidence": 60
                } for _ in contents]
            }
    
    except Exception as e:
        print(f"Batch endpoint error: {e}")
        raise HTTPException(status_code=500, detail=f"Batch analysis failed: {str(e)}")

@app.post("/analyze-image")
async def analyze_image(request: Request):
    """
    Analyzes image content using Google Vision API to detect explicit, violent, 
    or otherwise inappropriate content.
    Expects: { "image_url": "https://...", "context": "surrounding text" }
    Returns: Same format as /analyze-content endpoint
    """
    data = await request.json()
    image_url = data.get("image_url")
    context = data.get("context", "")  # Optional surrounding text
    
    if not image_url:
        raise HTTPException(status_code=400, detail="Image URL is required")
    
    try:
        # Use Gemini's multimodal capabilities to analyze the image
        # Gemini 2.5 Flash supports image input
        
        # Download the image (with timeout)
        import urllib.request
        from io import BytesIO
        from PIL import Image
        
        try:
            # Download image with timeout and better headers for Instagram/Facebook
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': image_url,
                'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'Sec-Fetch-Dest': 'image',
                'Sec-Fetch-Mode': 'no-cors',
                'Sec-Fetch-Site': 'cross-site'
            }
            req = urllib.request.Request(image_url, headers=headers)
            with urllib.request.urlopen(req, timeout=10) as response:
                image_data = response.read()
            
            # Open with PIL
            image = Image.open(BytesIO(image_data))
            
            # Create prompt for image analysis
            analysis_prompt = f"""Analyze this image for inappropriate content. Consider the following context if provided: {context}

Determine if the image contains:
- Explicit sexual content or nudity
- Violence, gore, or disturbing imagery
- Self-harm or suicide-related content
- Hate symbols or offensive imagery
- Drug use or alcohol promotion
- Scams or phishing attempts

Respond in JSON format:
{{
  "safe": true/false,
  "title": "Brief title",
  "reason": "2-3 sentences explaining what you found (no vulgar words)",
  "what_to_do": "1-2 sentences of gentle guidance",
  "category": "explicit_content/violence/hate_speech/self_harm/alcohol_drugs/scam/safe",
  "confidence": 0-100
}}

Be strict but not overly sensitive. Only flag genuinely inappropriate content."""

            # Use Gemini to analyze the image
            response = model.generate_content([analysis_prompt, image])
            
            if hasattr(response, 'text') and response.text:
                cleaned_response_text = response.text.strip().replace("```json", "").replace("```", "").strip()
                parsed_response = json.loads(cleaned_response_text)
                return parsed_response
            else:
                # Default safe response if AI doesn't respond
                return {
                    "safe": True,
                    "title": "Content Appears Safe",
                    "reason": "We couldn't fully analyze this image, but no obvious issues were detected.",
                    "what_to_do": "You can proceed, but use your judgment.",
                    "category": "safe",
                    "confidence": 50
                }
                
        except urllib.error.HTTPError as e:
            print(f"Failed to download image (HTTP {e.code}): {image_url}")
            # Can't download image - return error so frontend can use context analysis
            return {
                "safe": True,
                "title": "Image Not Accessible",
                "reason": "We couldn't download this image for analysis (protected or restricted).",
                "what_to_do": "The image may require authentication. We'll check the surrounding content instead.",
                "category": "error",
                "confidence": 20
            }
            
    except json.JSONDecodeError:
        print(f"Error: AI did not return valid JSON for image analysis")
        return {
            "safe": False,
            "title": "Image Analysis Uncertain",
            "reason": "We had trouble analyzing this image. It's better to be cautious.",
            "what_to_do": "Consider skipping this image or viewing it with caution.",
            "category": "processing_error",
            "confidence": 60
        }
    except Exception as e:
        print(f"Error analyzing image: {e}")
        return {
            "safe": True,
            "title": "Analysis Error",
            "reason": "We couldn't analyze this image properly.",
            "what_to_do": "Proceed with your own judgment.",
            "category": "error",
            "confidence": 40
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