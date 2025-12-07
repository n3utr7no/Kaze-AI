import os
import json
import requests
import traceback
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from flask_cors import CORS
from groq import Groq
from dotenv import load_dotenv
from pydantic import BaseModel, Field, ValidationError
from typing import List, Optional, Dict, Any
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
import re

# --- 1. SETUP & CONFIGURATION ---
load_dotenv()
app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
WEATHER_API_KEY = os.getenv("WEATHER_API_KEY")
client = Groq(api_key=GROQ_API_KEY)

# --- 2. VALIDATION MODELS ---
class PlanRequest(BaseModel):
    text: str = Field(..., min_length=1, description="User input text")
    category: str = "Travel"
    language: str = "English"
    history: List[Dict[str, Any]] = []
    user_location: Optional[Dict[str, float]] = None

# --- 3. HELPER FUNCTIONS ---

@retry(
    stop=stop_after_attempt(3), 
    wait=wait_exponential(multiplier=1, min=1, max=10),
    retry=retry_if_exception_type(Exception)
)
def call_llm(messages, response_format=None, model="llama-3.3-70b-versatile"):
    """
    Wrapper for Groq API call with automatic retries.
    Defaults to 70B model, but allows overriding for speed.
    """
    return client.chat.completions.create(
        model=model,
        messages=messages,
        response_format=response_format
    )

def sanitize_input(text):
    """
    Basic security check. 
    Only blocks attempts to override system instructions.
    Content moderation is now handled by the LLM in Phase 1.
    """
    if not text: return ""
    # Only block structural attacks
    forbidden_phrases = ["ignore previous instructions", "system override", "delete database", "drop table"]
    lower_text = text.lower()
    for phrase in forbidden_phrases:
        if phrase in lower_text:
            print(f"SECURITY ALERT: Prompt injection attempt -> '{phrase}'")
            raise ValueError("System Security Alert: Input blocked.")
    return text.strip()

def get_weather_forecast(city_name, day_offset=0, coords=None):
    """Fetches weather for a specific day using OpenWeatherMap."""
    try:
        lat, lon, display_name = None, None, city_name
        
        # A. Coordinate Resolution
        if coords:
            lat, lon = coords.get('lat'), coords.get('lon')
            try:
                rev_url = f"http://api.openweathermap.org/geo/1.0/reverse?lat={lat}&lon={lon}&limit=1&appid={WEATHER_API_KEY}"
                rev_res = requests.get(rev_url).json()
                if rev_res: display_name = rev_res[0]['name']
            except: 
                display_name = "Current Location"
        else:
            geo_url = f"http://api.openweathermap.org/geo/1.0/direct?q={city_name}&limit=1&appid={WEATHER_API_KEY}"
            geo_res = requests.get(geo_url).json()
            if not geo_res: 
                return {"temp": "--", "cond": "Not Found", "icon_code": "", "date": "Unknown", "city_name": city_name}
            lat, lon = geo_res[0]['lat'], geo_res[0]['lon']
            display_name = geo_res[0]['name']

        # B. Fetch Forecast
        url = "http://api.openweathermap.org/data/2.5/forecast"
        params = {"lat": lat, "lon": lon, "appid": WEATHER_API_KEY, "units": "metric", "lang": "en"}
        r = requests.get(url, params=params)
        data = r.json()

        # C. Filter Timestamp
        target_date = (datetime.now() + timedelta(days=day_offset)).strftime('%Y-%m-%d')
        daily_items = [item for item in data['list'] if target_date in item['dt_txt']]
        
        selected_weather = None
        if not daily_items: 
            selected_weather = data['list'][-1]
        else:
            noon_item = next((item for item in daily_items if "12:00:00" in item['dt_txt']), None)
            selected_weather = noon_item or daily_items[0]

        return {
            "temp": round(selected_weather["main"]["temp"]),
            "cond": selected_weather["weather"][0]["description"],
            "icon_code": selected_weather["weather"][0]["icon"],
            "date": target_date,
            "city_name": display_name 
        }
    except Exception as e:
        print(f"Weather Error: {e}")
        return {"temp": "--", "cond": "Error", "icon_code": "", "date": "Unknown", "city_name": city_name}


def process_timeline(timeline):
    """Formats timeline items for the frontend (Map + List)."""
    processed = []
    
    # Safety: Ensure timeline is actually a list
    if not isinstance(timeline, list):
        return []

    for item in timeline:
        # CASE A: Item is a Dictionary (Expected)
        if isinstance(item, dict):
            time = item.get("time", "").strip()
            activity = item.get("activity", "").strip()
            desc = item.get("description", "").strip()
            coords = item.get("coordinates", [])
            
            # Regex Cleaning
            activity = re.sub(r"^[-•\d\.;]+\s*", "", activity)
            desc = re.sub(r"^[-•\d\.;]+\s*", "", desc)
            
            if time and time.lower() not in ["null", "none", ""]:
                display_text = f"{time}: {activity} - {desc}"
            else:
                display_text = f"{activity} - {desc}"
            
            valid_coords = None
            if isinstance(coords, list) and len(coords) == 2:
                valid_coords = coords

            processed.append({
                "text": display_text,
                "coords": valid_coords,
                "name": activity
            })

        # CASE B: Item is a String (LLM Fallback/Error)
        elif isinstance(item, str):
            clean_text = re.sub(r"^[-•\d\.;]+\s*", "", item.strip())
            processed.append({
                "text": clean_text,
                "coords": None,
                "name": clean_text[:20] + "..." # truncated for marker title
            })

    return processed

# --- 4. ROUTES ---

@app.route('/', methods=['GET'])
def health():
    return "ok", 200

@app.route('/transcribe', methods=['POST'])
def transcribe():
    if 'audio' not in request.files: return jsonify({"error": "No audio"}), 400
    try:
        audio_file = request.files['audio']
        filename = audio_file.filename or "temp_live.webm"
        audio_file.save(filename)
        
        with open(filename, "rb") as file:
            # Removed language="ja" to allow auto-detection
            transcription = client.audio.transcriptions.create(
                file=(filename, file.read()),
                model="whisper-large-v3",
                response_format="json"
            )
        
        if os.path.exists(filename): os.remove(filename)
            
        # Smart Translation: Detects source and flips it
        trans_res = call_llm([
            {
                "role": "system", 
                "content": """
                You are a bilingual translation engine (English <-> Japanese).
                1. Detect the language of the user input.
                2. If text is English -> Translate to natural Japanese.
                3. If text is Japanese -> Translate to natural English.
                4. Output ONLY the translation. No explanations.
                """
            }, 
            {"role": "user", "content": transcription.text}
        ], model="openai/gpt-oss-20b")
        
        return jsonify({
            "transcript": transcription.text, # The spoken text
            "translation": trans_res.choices[0].message.content # The opposite language
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/generate_plan', methods=['POST'])
def generate_plan():
    try:
        # 1. INPUT VALIDATION
        try:
            req_data = PlanRequest(**request.json)
        except ValidationError as e:
            return jsonify({"error": "Invalid Input Schema", "details": e.errors()}), 400

        # 2. SANITIZATION
        user_text = sanitize_input(req_data.text)
        
        # 3. PHASE 1: ANALYSIS (OPTIMIZED)
        # We explicitly tell the model the target language for the translation field.
        analysis_messages = [{"role": "system", "content": f"""
            You are a smart semantic router for a Travel Concierge App.
            
            1. **SAFETY CHECK**: Is the user request related to Travel, Lifestyle, Food, Culture, or Weather?
               - If YES: Set 'status' = 'valid'.
               - If NO (e.g. user asks for Python code, math homework, political essays, or harmful content): Set 'status' = 'invalid'.
            
            2. **EXTRACTION**: If status valid, extract:
               - 'city' (English). Default 'Tokyo'. Use 'CURRENT_LOCATION' if implied.
               - 'day_offset' (0=Today, 1=Tomorrow...).
               - 'translation': Translate the user input text into natural oppsite language of the input language (EN <-> JA).
            
            Output strict JSON: {{ "status": "valid/invalid", "city": "...", "day_offset": 0, "translation": "..." }}
        """}]
        
        for msg in req_data.history[-2:]:
            analysis_messages.append({"role": msg['role'], "content": str(msg['content'])})
        analysis_messages.append({"role": "user", "content": user_text})

        analysis_res = call_llm(
            analysis_messages, 
            response_format={"type": "json_object"},
            model="openai/gpt-oss-20b" 
        )
        analysis = json.loads(analysis_res.choices[0].message.content)
        
        target_city = analysis.get("city", "Tokyo")
        
        # FIX: Ensure translation is never None, and don't wipe it if it matches input
        user_translation = analysis.get("translation", user_text) 

        # 4. PHASE 2: WEATHER FETCH
        if target_city == "CURRENT_LOCATION" and req_data.user_location:
            weather_data = get_weather_forecast(None, analysis.get("day_offset", 0), coords=req_data.user_location)
            target_city = weather_data['city_name']
        else:
            weather_data = get_weather_forecast(target_city, analysis.get("day_offset", 0))

        
        # 5. PHASE 3: PLANNING & GENERATION
        system_prompt = f"""
        ### ROLE
        You are a world-class local concierge specializing in {req_data.category}.
        Your tone is polite, enthusiastic, and highly specific.

        ### CRITICAL INSTRUCTION
        The user has selected the category: **{req_data.category}**.
        You MUST frame your response strictly within the domain of **{req_data.category}**.
        If the conversation history discusses a different topic, IGNORE that context and pivot immediately to {req_data.category}.

        ### CONTEXT
        - Location: {target_city} (Date: {weather_data['date']})
        - Weather: {weather_data['cond']} ({weather_data['temp']}°C)
        - Target Languages: English 

        ### LOGIC TREE
        1. **ANALYZE INTENT**:
           - IF GREETING (e.g., "Hi", "Hello"): Ignore weather. Return "mode": "greeting".
           - IF PLANNING REQUEST: Use weather data to customize the plan. Return "mode": "itinerary".

        2. **EXECUTE MODE**:
           - **GREETING MODE**:
             - Intro: A warm, polite introduction.
             - Title: "How can I help you today?"
             - Timeline: 3 distinct, high-quality exploration suggestions of capabilities relevant to {req_data.category}. 
               - **DO NOT** use generic questions like "Find sushi".
               - **DO** use specific hooks like, "Suggest you a full day iternary" 
           
           - **ITINERARY MODE**:
             - Intro: A conversational opening sentence acknowledging the weather.
             - Title: Short, catchy title.
             - Weather Report: A friendly 1-sentence forecast report.
             - Timeline: 3 chronological activities. **BE SPECIFIC**: Name specific districts, food types, or famous spots. 
             - **CRITICAL FORMATTING**: Start the activity text directly with the first letter. Do NOT use dashes (-), bullets (•), numbers (1.), or semicolons (;) at the start of the string.

        3. **FORMATTING**:
           - Return raw JSON only.

        ### OUTPUT JSON SCHEMA
        {{
            "mode": "greeting" or "itinerary",
            "content": {{
                "en": {{
                    "intro": "Conversational opening in English",
                    "weather_report": "Specific forecast in English",
                    "title": "Short title in English",
                    "timeline": [
                        {{ 
                            "time": "Time (e.g. 9:00 AM)", 
                            "activity": "Activity Name", 
                            "description": "Details",
                            "coordinates": [35.6895, 139.6917] 
                        }}
                    ]
                }}
            }}
        }}
        """

        plan_messages = [{"role": "system", "content": system_prompt}]
        for msg in req_data.history:
            plan_messages.append({"role": msg['role'], "content": str(msg['content'])})
        plan_messages.append({"role": "user", "content": f"User Input: {user_text}"})

        plan_res = call_llm(plan_messages, response_format={"type": "json_object"})
        en_json = json.loads(plan_res.choices[0].message.content)
        
        # --- FIX: Drill down into 'en' key ---
        # The LLM output is { "content": { "en": { ... } } }
        root_content = en_json.get("content", {})
        en_data = root_content.get("en", {}) 
        
        # 4. TRANSLATION (Fast Model - EN -> JA)
        # We pass only the inner 'en' data to the translator to keep structure flat
        translation_prompt = f"""
        You are a JSON translator. 
        Translate the values of the following JSON object into Natural Japanese (Kanji/Kana).
        - Keep keys exactly the same.
        - Keep numeric coordinates exactly the same.
        - Translate 'activity', 'description', 'intro', 'weather_report', 'title', 'time'.
        
        Input JSON:
        {json.dumps(en_data)}
        """
        
        # Process Timeline Data safely
        trans_res = call_llm([{"role": "user", "content": translation_prompt}], response_format={"type": "json_object"}, model="openai/gpt-oss-20b")
        ja_data = json.loads(trans_res.choices[0].message.content)

        # 5. MERGE & RETURN
        return jsonify({
            "city": target_city, 
            "weather": weather_data,
            "category": req_data.category,
            "user_translation": user_translation,
            "content": {
                "en": {
                    "intro": en_data.get("intro", ""),
                    "report": en_data.get("weather_report", ""),
                    "title": en_data.get("title", ""),
                    "timeline_data": process_timeline(en_data.get("timeline", []))
                },
                "ja": {
                    "intro": ja_data.get("intro", ""),
                    "report": ja_data.get("weather_report", ""),
                    "title": ja_data.get("title", ""),
                    "timeline_data": process_timeline(ja_data.get("timeline", []))
                }
            }
        })

    except ValueError as ve:
        return jsonify({"error": str(ve), "title": "Security Alert"}), 400
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)