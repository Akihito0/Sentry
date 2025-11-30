import os
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import google.generativeai as genai
from datetime import datetime
from pathlib import Path
from threading import Lock
from typing import Any, Dict, List, Optional
import json
import numpy as np
from PIL import Image
import io
import base64
import urllib.request

from pydantic import BaseModel, Field

# --- NSFW Model Setup ---
NSFW_MODEL = None
# Model should be placed in: backend/app/models/sentry_content_filter.kiras
NSFW_MODEL_PATH = Path(__file__).parent / "models" / "sentry_content_filter.kiras"

def load_nsfw_model():
    """Load the KIRAS NSFW detection model."""
    global NSFW_MODEL
    if NSFW_MODEL is None:
        try:
            import pickle
            from tensorflow.keras import models
            from tensorflow.keras.optimizers import Adam
            
            if NSFW_MODEL_PATH.exists():
                print(f"📦 Loading NSFW model from: {NSFW_MODEL_PATH}")
                with open(NSFW_MODEL_PATH, 'rb') as f:
                    kiras_bundle = pickle.load(f)
                
                # Reconstruct the model
                model = models.model_from_json(kiras_bundle["architecture"])
                model.set_weights(kiras_bundle["weights"])
                model.compile(
                    optimizer=Adam(learning_rate=0.001),
                    loss='categorical_crossentropy',
                    metrics=['accuracy']
                )
                
                metadata = kiras_bundle["metadata"]
                class_indices = kiras_bundle["class_indices"]
                idx_to_class = {v: k for k, v in class_indices.items()}
                
                NSFW_MODEL = {
                    "model": model,
                    "metadata": metadata,
                    "class_indices": class_indices,
                    "idx_to_class": idx_to_class
                }
                print(f"✅ NSFW model loaded! Classes: {metadata['classes']}")
            else:
                print(f"⚠️ NSFW model not found at: {NSFW_MODEL_PATH}")
        except Exception as e:
            print(f"❌ Failed to load NSFW model: {e}")
    return NSFW_MODEL

def predict_nsfw(img_array):
    """Predict if an image is NSFW using the local model."""
    model_data = load_nsfw_model()
    if model_data is None:
        return None
    
    model = model_data["model"]
    metadata = model_data["metadata"]
    idx_to_class = model_data["idx_to_class"]
    
    # Ensure numpy array
    if not isinstance(img_array, np.ndarray):
        img_array = np.array(img_array)
    
    # Handle single image
    if len(img_array.shape) == 3:
        img_array = np.expand_dims(img_array, axis=0)
    
    # Resize if needed
    target_h = metadata['img_height']
    target_w = metadata['img_width']
    if img_array.shape[1:3] != (target_h, target_w):
        resized = []
        for i in range(img_array.shape[0]):
            img = Image.fromarray(img_array[i].astype('uint8'))
            img = img.resize((target_w, target_h), Image.Resampling.LANCZOS)
            resized.append(np.array(img))
        img_array = np.array(resized)
    
    # Normalize
    if np.max(img_array) > 1:
        img_array = img_array.astype('float32') / 255.0
    
    # Predict
    predictions = model.predict(img_array, verbose=0)
    
    predicted_idx = np.argmax(predictions[0])
    predicted_class = idx_to_class[predicted_idx]
    confidence = float(predictions[0][predicted_idx])
    
    return {
        "class": predicted_class,
        "confidence": confidence,
        "is_safe": predicted_class == "safe",
        "probabilities": {
            idx_to_class[i]: float(predictions[0][i])
            for i in range(len(predictions[0]))
        }
    }

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

BASE_DIR = Path(__file__).resolve().parent
FLAGGED_EVENTS_FILE = BASE_DIR / "flagged_events.json"
_flagged_events_lock = Lock()


def _load_flagged_events() -> List[Dict[str, Any]]:
    if not FLAGGED_EVENTS_FILE.exists():
        return []
    try:
        with FLAGGED_EVENTS_FILE.open("r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list):
                return data
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Warning: could not load flagged events: {exc}")
    return []


def _persist_flagged_events(events: List[Dict[str, Any]]) -> None:
    try:
        FLAGGED_EVENTS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with FLAGGED_EVENTS_FILE.open("w", encoding="utf-8") as f:
            json.dump(events, f, indent=2)
    except OSError as exc:
        print(f"Warning: could not persist flagged events: {exc}")


class FlaggedEvent(BaseModel):
    category: str = Field(..., description="Content category that triggered the alert")
    summary: str = Field(..., description="Short description for UI surfaces")
    reason: Optional[str] = Field(None, description="Full reason returned by AI")
    what_to_do: Optional[str] = Field(None, description="Guidance shown to the user")
    page_url: Optional[str] = None
    source: Optional[str] = None
    content_excerpt: Optional[str] = None
    severity: str = Field(default="medium", description="low/medium/high confidence")
    detected_at: datetime = Field(default_factory=datetime.utcnow)
    user_id: Optional[str] = Field(default=None, description="Optional owner id")
    metadata: Optional[Dict[str, Any]] = None


MAX_FLAGGED_EVENTS = 250
flagged_events_cache: List[Dict[str, Any]] = _load_flagged_events()


def _serialize_flagged_event(event: FlaggedEvent) -> Dict[str, Any]:
    serialized = event.model_dump()
    serialized["detected_at"] = event.detected_at.isoformat()
    return serialized


def _parse_event_datetime(value: Any) -> datetime:
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            pass
    return datetime.min

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


@app.get("/flagged-events")
async def get_flagged_events(
    limit: int = 25,
    category: Optional[str] = None,
    user_id: Optional[str] = None
):
    limit = max(1, min(limit, MAX_FLAGGED_EVENTS))

    with _flagged_events_lock:
        events = list(flagged_events_cache)

    if category:
        category_lower = category.lower()
        events = [
            event for event in events
            if category_lower in (event.get("category") or "").lower()
        ]

    if user_id:
        events = [
            event for event in events
            if event.get("user_id") == user_id
        ]

    events.sort(key=lambda event: _parse_event_datetime(event.get("detected_at")), reverse=True)

    return {"items": events[:limit]}


@app.post("/flagged-events")
async def create_flagged_event(event: FlaggedEvent):
    serialized = _serialize_flagged_event(event)

    with _flagged_events_lock:
        flagged_events_cache.append(serialized)
        if len(flagged_events_cache) > MAX_FLAGGED_EVENTS:
            overflow = len(flagged_events_cache) - MAX_FLAGGED_EVENTS
            del flagged_events_cache[0:overflow]
        _persist_flagged_events(flagged_events_cache)

    return {"status": "stored", "items": len(flagged_events_cache)}

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


@app.post("/educational-reason")
async def get_educational_reason(request: Request):
    """
    Generates an educational explanation for why certain content was blocked.
    Uses the ACTUAL blocked content to provide context-aware educational reasons.
    
    Expects: { "category": "profanity", "blocked_content": "the actual text", "context": "optional", "is_image": false }
    Returns: { "title": "...", "reason": "...", "what_to_do": "...", "category": "...", "confidence": 95 }
    """
    data = await request.json()
    category = data.get("category", "harmful_content")
    blocked_content = data.get("blocked_content", "")
    context = data.get("context", "")
    is_image = data.get("is_image", False)
    
    # Category-friendly names for the prompt
    category_names = {
        'profanity': 'inappropriate language/profanity',
        'hate_speech': 'hate speech or discriminatory language',
        'explicit_content': 'adult/explicit content',
        'explicit_image': 'inappropriate imagery',
        'sexual_conversation': 'inappropriate sexual messages',
        'predatory': 'predatory or grooming behavior',
        'violent': 'violent or threatening content',
        'harassment': 'harassment or bullying',
        'self_harm': 'self-harm related content',
        'alcohol_drugs': 'alcohol or drug-related content',
        'scam': 'potential scam or phishing',
        'fraud': 'fraudulent activity'
    }
    
    category_name = category_names.get(category, 'potentially harmful content')
    
    # Build the educational prompt with CLEAR separation
    # The content is passed as data to analyze, NOT as instructions
    educational_prompt = f"""You are Sentry, a caring educational AI. A user clicked on blocked content and wants to understand WHY it was blocked.

TASK: Generate an educational, age-appropriate explanation about why the following content was blocked. When Giving reasons refer to yourself or the system as Sentry.

---BEGIN BLOCKED CONTENT---
{blocked_content[:500] if blocked_content else "[No content excerpt available]"}
---END BLOCKED CONTENT---

{f"Additional context: {context}" if context else ""}

This content was categorized as: {category_name}
Content type: {"Image" if is_image else "Text"}

INSTRUCTIONS FOR YOUR RESPONSE:
1. Explain WHY this type of content ({category_name}) can be harmful - focus on mental health, safety, or ethical reasons
2. Be educational and supportive, NOT preachy or judgmental  
3. Do NOT repeat vulgar words or describe explicit content in detail
4. Make it appropriate for a 12-year-old to read
5. If the content contains specific concerning elements, address WHY those are problematic (without repeating them)
6. Provide helpful guidance on what the user should do

Respond with ONLY this JSON (no markdown, no extra text):
{{"safe": false, "title": "3-5 word friendly title", "reason": "2-3 sentence educational explanation", "what_to_do": "1-2 sentence supportive guidance", "category": "{category}", "confidence": 95}}"""

    try:
        response = model.generate_content(educational_prompt)
        
        if hasattr(response, 'text') and response.text:
            cleaned_response_text = response.text.strip().replace("```json", "").replace("```", "").strip()
            parsed_response = json.loads(cleaned_response_text)
            print(f"✅ Educational reason generated for category: {category}")
            return parsed_response
        else:
            # Fallback response
            return get_fallback_educational_response(category, is_image)
            
    except json.JSONDecodeError as e:
        print(f"Educational reason JSON error: {e}")
        return get_fallback_educational_response(category, is_image)
    except Exception as e:
        print(f"Educational reason error: {e}")
        return get_fallback_educational_response(category, is_image)


def get_fallback_educational_response(category: str, is_image: bool = False) -> dict:
    """Returns a pre-defined educational response when AI fails."""
    fallback_responses = {
        'profanity': {
            'title': "Inappropriate Language Detected",
            'reason': "This content contains language that can hurt others and create a negative environment. Words have power, and using respectful language helps build better relationships and communities.",
            'what_to_do': "Consider how your words affect others. If this was directed at you, remember you don't deserve to be spoken to disrespectfully."
        },
        'hate_speech': {
            'title': "Harmful Speech Detected",
            'reason': "This content contains language that targets people based on who they are. Everyone deserves to be treated with dignity and respect, regardless of their background or identity.",
            'what_to_do': "Report hateful content when you see it. If you're being targeted, talk to a trusted adult."
        },
        'explicit_content': {
            'title': "Adult Content Blocked",
            'reason': "This content is intended for adults only and can impact mental wellbeing, especially for younger viewers. Exposure to such material at a young age can affect healthy development.",
            'what_to_do': "Navigate away from this content. If you're underage, this content is not appropriate for you."
        },
        'explicit_image': {
            'title': "Inappropriate Image Blocked",
            'reason': "This image contains content that may not be suitable for all audiences. Viewing explicit imagery can negatively impact mental wellbeing and is typically age-restricted for good reason.",
            'what_to_do': "Practice safe browsing. If you encounter inappropriate images unexpectedly, close the page."
        },
        'sexual_conversation': {
            'title': "Inappropriate Message Detected",
            'reason': "This message contains inappropriate content that may make you uncomfortable. Such conversations can be a form of harassment, especially when unsolicited.",
            'what_to_do': "Don't feel pressured to respond. Block the sender and talk to a trusted adult if you feel uncomfortable."
        },
        'predatory': {
            'title': "Warning: Unsafe Interaction",
            'reason': "This content shows warning signs of manipulative behavior. Predators often use flattery, secrecy, and gifts to build trust before asking for inappropriate things.",
            'what_to_do': "Never share personal information with strangers online. Tell a trusted adult immediately if someone makes you uncomfortable."
        },
        'violent': {
            'title': "Violent Content Detected",
            'reason': "This content contains violence that can be disturbing and affect your mental wellbeing. Repeated exposure to violent content can lead to desensitization.",
            'what_to_do': "Skip this content to protect your peace of mind. If you feel threatened, contact authorities."
        },
        'harassment': {
            'title': "Harassment Detected",
            'reason': "This content is designed to hurt or intimidate someone. Cyberbullying can have serious effects on mental health and no one deserves to be treated this way.",
            'what_to_do': "Save evidence, report the content, and block the person. Talk to someone you trust about what happened."
        },
        'self_harm': {
            'title': "Sensitive Content Warning",
            'reason': "This content discusses topics that may be triggering. If you're struggling, please know that help is available and you are not alone.",
            'what_to_do': "Reach out: HOPELINE Philippines: 0917-558-4673 | US: 988 | Crisis Text Line: Text HOME to 741741"
        },
        'alcohol_drugs': {
            'title': "Substance-Related Content",
            'reason': "This content involves alcohol or drugs. Substance use can have serious health consequences and is often illegal for minors.",
            'what_to_do': "Be aware of the risks. If you or someone you know needs help, reach out to a counselor or trusted adult."
        },
        'scam': {
            'title': "Potential Scam Detected",
            'reason': "This message shows signs of a scam. Scammers use promises of easy money, fake prizes, and urgency to trick people into sharing information or money.",
            'what_to_do': "Do not click links or share personal information. Legitimate opportunities don't require upfront payment."
        },
        'fraud': {
            'title': "Fraud Attempt Detected",
            'reason': "This appears to be an attempt to steal your information or money. Scammers often pretend to be from trusted companies.",
            'what_to_do': "Never share passwords or financial details via message. Contact companies directly through official channels."
        }
    }
    
    response = fallback_responses.get(category, {
        'title': "Content Blocked",
        'reason': "This content was blocked to protect your wellbeing. Some online content can be harmful or inappropriate.",
        'what_to_do': "Consider navigating away from this content."
    })
    
    return {
        "safe": False,
        "title": response['title'],
        "reason": response['reason'],
        "what_to_do": response['what_to_do'],
        "category": category,
        "confidence": 90
    }


class NSFWAnalysisRequest(BaseModel):
    """Request model for NSFW image analysis."""
    image_url: Optional[str] = Field(None, description="URL of the image to analyze (e.g., https://example.com/image.jpg)")
    image_base64: Optional[str] = Field(None, description="Base64-encoded image data (e.g., data:image/jpeg;base64,/9j/4AAQ...)")


@app.post("/analyze-image-nsfw")
async def analyze_image_nsfw(request_data: NSFWAnalysisRequest):
    """
    Analyzes image content using the LOCAL KIRAS NSFW model.
    Much faster and more accurate than Gemini for NSFW detection.
    
    Provide either image_url OR image_base64 (not both required).
    
    Returns: { "safe": bool, "class": str, "confidence": float, "probabilities": {...} }
    """
    image_url = request_data.image_url
    image_base64 = request_data.image_base64
    
    # Clean up empty/default strings from Swagger UI
    if image_url and image_url.strip() in ["", "string"]:
        image_url = None
    if image_base64 and image_base64.strip() in ["", "string"]:
        image_base64 = None
    
    if not image_url and not image_base64:
        raise HTTPException(status_code=400, detail="image_url or image_base64 is required")
    
    try:
        # Load image from URL or base64
        if image_base64 and image_base64.startswith("data:"):
            # Handle base64 image (must start with data: prefix)
            if ',' in image_base64:
                image_base64 = image_base64.split(',')[1]
            img_bytes = base64.b64decode(image_base64)
            img = Image.open(io.BytesIO(img_bytes))
        elif image_base64 and len(image_base64) > 100:
            # Raw base64 without data: prefix (long string = likely base64)
            img_bytes = base64.b64decode(image_base64)
            img = Image.open(io.BytesIO(img_bytes))
        elif image_url:
            # Download from URL
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'image/*,*/*;q=0.8',
            }
            req = urllib.request.Request(image_url, headers=headers)
            with urllib.request.urlopen(req, timeout=10) as response:
                image_data = response.read()
            img = Image.open(io.BytesIO(image_data))
        else:
            raise HTTPException(status_code=400, detail="Valid image_url or image_base64 is required")
        
        # Convert to RGB if necessary
        if img.mode != 'RGB':
            img = img.convert('RGB')
        
        # Log image info for debugging
        print(f"🔍 NSFW Analysis - Image size: {img.size}, mode: {img.mode}")
        
        # Run NSFW prediction
        result = predict_nsfw(np.array(img))
        
        # Log the raw result
        print(f"📊 NSFW Result: {result}")
        
        if result is None:
            # Model not loaded, fall back to safe
            return {
                "safe": True,
                "title": "Model Not Available",
                "reason": "NSFW detection model is not loaded.",
                "what_to_do": "Proceed with caution.",
                "category": "error",
                "confidence": 0
            }
        
        # Format response to match extension's expected format
        is_safe = result["is_safe"]
        confidence = result["confidence"] * 100
        
        if is_safe:
            return {
                "safe": True,
                "title": "Image Appears Safe",
                "reason": f"This image was classified as safe with {confidence:.1f}% confidence.",
                "what_to_do": "No action needed.",
                "category": "safe",
                "confidence": round(confidence),
                "class": result["class"],
                "probabilities": result["probabilities"]
            }
        else:
            return {
                "safe": False,
                "title": "Inappropriate Image Detected",
                "reason": f"This image has been flagged as potentially inappropriate with {confidence:.1f}% confidence.",
                "what_to_do": "Click to view if you're certain you want to proceed.",
                "category": "explicit_content",
                "confidence": round(confidence),
                "class": result["class"],
                "probabilities": result["probabilities"]
            }
            
    except urllib.error.HTTPError as e:
        print(f"Failed to download image: {e}")
        return {
            "safe": True,
            "title": "Image Not Accessible",
            "reason": "Could not download the image for analysis.",
            "what_to_do": "Proceed with caution.",
            "category": "error",
            "confidence": 0
        }
    except Exception as e:
        print(f"Error in NSFW analysis: {e}")
        import traceback
        traceback.print_exc()
        return {
            "safe": True,
            "title": "Analysis Error",
            "reason": f"Error analyzing image: {str(e)}",
            "what_to_do": "Proceed with your own judgment.",
            "category": "error",
            "confidence": 0
        }


@app.get("/nsfw-model-status")
async def nsfw_model_status():
    """Check if the NSFW model is loaded and ready."""
    model_data = load_nsfw_model()
    if model_data:
        return {
            "loaded": True,
            "model_name": model_data["metadata"]["model_name"],
            "version": model_data["metadata"]["version"],
            "classes": model_data["metadata"]["classes"]
        }
    return {"loaded": False}