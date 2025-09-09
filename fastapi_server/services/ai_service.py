# This file no longer configures the API key. It only defines the analysis logic.

# The 'model' and 'PROMPT_TEMPLATE' will now be passed in from main.py
def get_ai_response(model, prompt_template: str, page_text: str):
    """
    Analyzes the page text using the provided AI model and prompt.
    """
    prompt = prompt_template.format(page_text=page_text)
    
    try:
        response = model.generate_content(prompt)
        
        # Check if the response was blocked by Google's safety filters
        if not response.candidates:
            block_reason = response.prompt_feedback.block_reason
            print(f"AI response was blocked by Google's safety filter. Reason: {block_reason}")
            # Return a clear reason for the block
            return {"is_safe": False, "reason": f"AI safety block ({block_reason})"}

        result_text = response.text.strip().upper() # Convert the whole response to uppercase
        
        # --- FLEXIBLE LOGIC ---
        
        if "UNSAFE" in result_text:
            # Split the original (non-uppercased) text to get the reason
            reason = response.text.strip().split(":", 1)[-1].strip()
            return {"is_safe": False, "reason": reason if reason else "Unspecified Harmful Content"}
        elif "SAFE" in result_text:
            reason = response.text.strip().split(":", 1)[-1].strip()
            return {"is_safe": True, "reason": reason if reason else "Content is safe"}
        else:
            # --- THIS IS THE NEW, IMPROVED PART ---
            # If neither keyword is found, the AI failed to follow the format.
            # We now return a clear, human-readable reason for the block.
            print(f"AI response format error. Full response: {response.text.strip()}")
            return {"is_safe": False, "reason": "AI analysis was inconclusive. Blocking as a precaution."}

    except Exception as e:
        print(f"An unexpected error occurred during AI analysis: {e}")
        # Raise an exception to be handled by the main endpoint
        raise e