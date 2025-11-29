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

# 1. SETUP
load_dotenv()
app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
WEATHER_API_KEY = os.getenv("WEATHER_API_KEY")
client = Groq(api_key=GROQ_API_KEY)

# 2. VALIDATION MODELS
class PlanRequest(BaseModel):
    text: str = Field(..., min_length=1, description="User input text")
    category: str = "Travel"
    language: str = "English"
    history: List[Dict[str, Any]] = []
    user_location: Optional[Dict[str, float]] = None

# 3. HELPER FUNCTIONS

@retry(
    stop=stop_after_attempt(3), 
    wait=wait_exponential(multiplier=1, min=1, max=10),
    retry=retry_if_exception_type(Exception)
)
def call_llm(messages, response_format=None):
    """Wrapper for Groq API call with automatic retries."""
    return client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=messages,
        response_format=response_format
    )

def sanitize_input(text):
    """Heuristic check for Prompt Injection attacks."""
    if not text: return ""
    forbidden_phrases = ["ignore previous instructions", "system override", "delete database", "drop table"]
    lower_text = text.lower()
    for phrase in forbidden_phrases:
        if phrase in lower_text:
            print(f"SECURITY ALERT: Prompt injection attempt -> '{phrase}'")
            raise ValueError("Invalid input detected (Security Alert).")
    return text.strip()

def get_weather_forecast(city_name, day_offset=0, coords=None):
    """Fetches weather for a specific day."""
    try:
        lat, lon, display_name = None, None, city_name
        
        # A. Coordinate Resolution
        if coords:
            lat, lon = coords.get('lat'), coords.get('lon')
            try:
                rev_url = f"http://api.openweathermap.org/geo/1.0/reverse?lat={lat}&lon={lon}&limit=1&appid={WEATHER_API_KEY}"
                rev_res = requests.get(rev_url).json()
                if rev_res: display_name = rev_res[0]['name']
            except: display_name = "Current Location"
        else:
            geo_url = f"http://api.openweathermap.org/geo/1.0/direct?q={city_name}&limit=1&appid={WEATHER_API_KEY}"
            geo_res = requests.get(geo_url).json()
            if not geo_res: return {"temp": "--", "cond": "Not Found", "icon_code": "", "date": "Unknown", "city_name": city_name}
            lat, lon = geo_res[0]['lat'], geo_res[0]['lon']
            display_name = geo_res[0]['name']

        # B. Fetch Forecast
        url = "http://api.openweathermap.org/data/2.5/forecast"
        params = {"lat": lat, "lon": lon, "appid": WEATHER_API_KEY, "units": "metric", "lang": "ja"}
        r = requests.get(url, params=params)
        data = r.json()

        # C. Filter Timestamp
        target_date = (datetime.now() + timedelta(days=day_offset)).strftime('%Y-%m-%d')
        daily_items = [item for item in data['list'] if target_date in item['dt_txt']]
        
        if not daily_items: selected_weather = data['list'][-1]
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

# 4. ROUTES

@app.route('/transcribe', methods=['POST'])
def transcribe():
    if 'audio' not in request.files: return jsonify({"error": "No audio"}), 400
    try:
        audio_file = request.files['audio']
        filename = audio_file.filename or "temp_live.webm"
        audio_file.save(filename)
        
        with open(filename, "rb") as file:
            transcription = client.audio.transcriptions.create(
                file=(filename, file.read()),
                model="whisper-large-v3",
                language="ja", prompt="こんにちは", response_format="json"
            )
        
        if os.path.exists(filename): os.remove(filename)
            
        trans_res = call_llm([
            {
                "role": "system", 
                "content": """
                You are a strict translation engine. 
                Task: Translate the user's text into English.
                CRITICAL RULES:
                1. Do NOT answer the question.
                2. Do NOT say "I cannot check the weather".
                3. Do NOT add explanations.
                4. Output ONLY the translated text.
                """
            }, 
            {"role": "user", "content": transcription.text}
        ])
        
        return jsonify({"transcript": transcription.text, "translation": trans_res.choices[0].message.content})
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
        
        # 3. PHASE 1: ANALYSIS
        analysis_messages = [{"role": "system", "content": """
            You are a data extractor.
            1. Extract 'city' (English). If user says 'here'/'my location', set 'CURRENT_LOCATION'. Default 'Tokyo'.
            2. Extract 'day_offset' (0=Today, 1=Tomorrow...).
            3. Translate 'translation': Translate user text to the OPPOSITE language. 
               - If Input is English -> Output Japanese.
               - If Input is Japanese -> Output English.
            
            Output strict JSON.
        """}]
        
        for msg in req_data.history[-2:]:
            analysis_messages.append({"role": msg['role'], "content": str(msg['content'])})
        analysis_messages.append({"role": "user", "content": user_text})

        analysis_res = call_llm(analysis_messages, response_format={"type": "json_object"})
        analysis = json.loads(analysis_res.choices[0].message.content)
        
        target_city = analysis.get("city", "Tokyo")
        user_translation = analysis.get("translation", "")
        if not user_translation or user_translation == user_text: user_translation = ""

        # 4. PHASE 2: WEATHER FETCH
        if target_city == "CURRENT_LOCATION" and req_data.user_location:
            weather_data = get_weather_forecast(None, analysis.get("day_offset", 0), coords=req_data.user_location)
            target_city = weather_data['city_name']
        else:
            weather_data = get_weather_forecast(target_city, analysis.get("day_offset", 0))

        # 5. PHASE 3: PLANNING 
        lang_instruction = "ENGLISH" if req_data.language == 'English' else "JAPANESE (日本語)"
        time_example = "Morning / 9:00 AM" if req_data.language == 'English' else "朝 / 9:00"

        system_prompt = f"""
        ### ROLE
        You are a world-class local concierge specializing in {req_data.category}.
        Your tone is polite, enthusiastic, and highly specific.

        ### CONTEXT
        - Location: {target_city} (Date: {weather_data['date']})
        - Weather: {weather_data['cond']} ({weather_data['temp']}°C)
        - Target Language: {lang_instruction}

        ### LOGIC TREE
        1. **ANALYZE INTENT**:
           - IF GREETING (e.g., "Hi", "Hello"): Ignore weather. Return "mode": "greeting".
           - IF PLANNING REQUEST: Use weather data to customize the plan (e.g., indoor spots for rain). Return "mode": "itinerary".

        2. **EXECUTE MODE**:
           - **GREETING MODE**:
             - Intro: A warm, polite welcome back in {lang_instruction}.
             - Title: "Welcome" or similar greeting.
             - Timeline: 3 suggested questions the user can ask next (e.g., "Ask about Sushi in Ginza").
           
           - **ITINERARY MODE**:
             - Intro: A conversational opening sentence acknowledging the weather (e.g., "Since it is sunny tomorrow, I recommend...").
             - Title: Short, catchy title.
             - Weather Report: A friendly 1-sentence forecast report.
             - Timeline: 3 chronological activities. **BE SPECIFIC**: Name specific districts, food types, or famous spots. Do not give generic advice like "Eat lunch".
             - Emojis: No emojis are to be used anywhere.

        3. **FORMATTING**:
           - Output strictly in **{lang_instruction}**.
           - Return raw JSON only.

        ### OUTPUT JSON SCHEMA
        {{
            "mode": "greeting" or "itinerary",
            "intro": "Conversational opening sentence",
            "weather_report": "Specific forecast (or null if greeting)",
            "title": "Short title",
            "timeline": [
                {{ "time": "Time (Ex: '{time_example}')", "activity": "Specific Activity Name", "description": "Why this fits the weather/vibe" }}
            ]
        }}
        """
        
        plan_messages = [{"role": "system", "content": system_prompt}]
        for msg in req_data.history:
            plan_messages.append({"role": msg['role'], "content": str(msg['content'])})
        plan_messages.append({"role": "user", "content": f"User Input: {user_text}"})

        plan_res = call_llm(plan_messages, response_format={"type": "json_object"})
        plan_data = json.loads(plan_res.choices[0].message.content)

        formatted_points = []
        for item in plan_data.get("timeline", []):
            time = item.get("time", "").strip()
            activity = item.get("activity", "")
            desc = item.get("description", "")
            
            if time and time.lower() not in ["null", "none", ""]:
                formatted_points.append(f"{time}: {activity} - {desc}")
            else:
                formatted_points.append(f"{activity} - {desc}")

        return jsonify({
            "city": target_city, 
            "weather": weather_data,
            "intro": plan_data.get("intro", ""), 
            "report": plan_data.get("weather_report", ""),
            "title": plan_data.get("title", "Suggestion"),
            "points": formatted_points,
            "category": req_data.category,
            "user_translation": user_translation
        })

    except ValueError as ve:
        return jsonify({"error": str(ve), "title": "Security Alert"}), 400
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)