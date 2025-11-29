import os
import json
import requests
import traceback
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from flask_cors import CORS
from groq import Groq
from dotenv import load_dotenv

load_dotenv()
app = Flask(__name__)
# Allow all origins for development; restrict this in production
CORS(app, resources={r"/*": {"origins": "*"}})

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
WEATHER_API_KEY = os.getenv("WEATHER_API_KEY")
client = Groq(api_key=GROQ_API_KEY)

def get_weather_forecast(city_name, day_offset=0, coords=None):
    """
    Fetches weather for a specific day.
    Prioritizes GPS coordinates for accuracy, falls back to text search.
    """
    try:
        lat, lon = None, None
        display_name = city_name

        # 1. Coordinate Resolution
        if coords:
            lat, lon = coords['lat'], coords['lon']
            # Reverse Geocoding: Essential to convert raw coords back to a human-readable city name for the UI
            try:
                rev_url = f"http://api.openweathermap.org/geo/1.0/reverse?lat={lat}&lon={lon}&limit=1&appid={WEATHER_API_KEY}"
                rev_res = requests.get(rev_url).json()
                if rev_res:
                    display_name = rev_res[0]['name']
            except:
                display_name = "Current Location"
        else:
            # Direct Geocoding: Text -> Lat/Lon
            geo_url = f"http://api.openweathermap.org/geo/1.0/direct?q={city_name}&limit=1&appid={WEATHER_API_KEY}"
            geo_res = requests.get(geo_url).json()
            if not geo_res: 
                return {"temp": "--", "cond": "Not Found", "icon_code": "", "date": "Unknown", "city_name": city_name}
            lat, lon = geo_res[0]['lat'], geo_res[0]['lon']
            display_name = geo_res[0]['name']

        # 2. Fetch 5-Day Forecast
        url = "http://api.openweathermap.org/data/2.5/forecast"
        params = {"lat": lat, "lon": lon, "appid": WEATHER_API_KEY, "units": "metric", "lang": "ja"}
        r = requests.get(url, params=params)
        data = r.json()

        # 3. Filter specific timestamp
        # OWM returns data in 3-hour intervals. We need to pick one representative point for the "Day".
        # Logic: Prioritize Noon -> Afternoon -> First available slot.
        target_date = (datetime.now() + timedelta(days=day_offset)).strftime('%Y-%m-%d')
        daily_items = [item for item in data['list'] if target_date in item['dt_txt']]

        selected_weather = None
        if not daily_items:
            # Fallback for edge cases (late night requests where "today" might be over in UTC)
            selected_weather = data['list'][-1]
        else:
            noon_item = next((item for item in daily_items if "12:00:00" in item['dt_txt']), None)
            afternoon_item = next((item for item in daily_items if "15:00:00" in item['dt_txt']), None)
            selected_weather = noon_item or afternoon_item or daily_items[0]

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
    

@app.route('/transcribe', methods=['POST'])
def transcribe():
    if 'audio' not in request.files: 
        return jsonify({"error": "No audio"}), 400
    
    try:
        audio_file = request.files['audio']
        # Preserve extension (.webm/.mp4) to help Whisper decode headers correctly
        filename = audio_file.filename or "temp_live.webm"
        audio_file.save(filename)
        
        with open(filename, "rb") as file:
            transcription = client.audio.transcriptions.create(
                file=(filename, file.read()),
                model="whisper-large-v3",
                language="ja",
                prompt="こんにちは", # Initial prompt biases Whisper to expect Japanese, improving accuracy on short clips
                response_format="json"
            )
        
        ja_text = transcription.text
        
        # Auxiliary Translation:
        # We translate to English here because LLMs often reason better in English, 
        # allowing for better "Intent Detection" in the next step.
        trans_res = client.chat.completions.create(
            messages=[
                {"role": "system", "content": "Translate Japanese to English only. Output only the translation."}, 
                {"role": "user", "content": ja_text}
            ],
            model="llama-3.3-70b-versatile"
        )
        en_text = trans_res.choices[0].message.content
        
        if os.path.exists(filename):
            os.remove(filename)
            
        return jsonify({"transcript": ja_text, "translation": en_text})

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/generate_plan', methods=['POST'])
def generate_plan():
    data = request.json
    user_text = data.get('text', '')
    category = data.get('category', 'Travel')
    target_lang = data.get('language', 'English')
    history = data.get('history', []) 
    user_location = data.get('user_location', None)
    
    try:
        # --- PHASE 1: Tool Parameters Extraction ---
        # Before generating the response, we must understand *what* data to fetch.
        # This LLM call acts as a semantic router/parser to extract City, Date Offset, and Translation.
        
        analysis_messages = [
            {
                "role": "system", 
                "content": """
                You are a data extractor.
                1. If the user mentions a specific city, extract it.
                2. If the user says 'here', 'nearby', 'my location', or asks a generic question WITHOUT a city, set 'city' to 'CURRENT_LOCATION'.
                3. If referring to a previous city (e.g. 'there'), use context.
                
                Output strict JSON:
                {
                    "city": "City Name OR 'CURRENT_LOCATION'",
                    "translation": "Translate input to opposite language.",
                    "day_offset": 0 (Today), 1 (Tomorrow), etc.
                }
                """
            }
        ]
        
        # Inject brief history for context resolution (e.g., user says "What about tomorrow?" -> implies same city as previous turn)
        for msg in history[-2:]:
            analysis_messages.append({"role": msg['role'], "content": str(msg['content'])})
            
        analysis_messages.append({"role": "user", "content": user_text})

        analysis_res = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=analysis_messages,
            response_format={"type": "json_object"}
        )
        
        analysis = json.loads(analysis_res.choices[0].message.content)
        target_city = analysis.get("city", "Tokyo")
        user_translation = analysis.get("translation", "")
        
        if not user_translation or user_translation == user_text:
             user_translation = ""

        # --- PHASE 2: Data Fetching ---
        if target_city == "CURRENT_LOCATION":
            if user_location:
                # High precision path: Device GPS
                weather_data = get_weather_forecast(None, analysis.get("day_offset", 0), coords=user_location)
                target_city = weather_data['city_name']
            else:
                # Fallback: Default to Tokyo if GPS permission denied
                target_city = "Tokyo"
                weather_data = get_weather_forecast(target_city, analysis.get("day_offset", 0))
        else:
            weather_data = get_weather_forecast(target_city, analysis.get("day_offset", 0))
        
        # --- PHASE 3: RAG / Response Generation ---
        # Now we have the weather context. We inject it into the final system prompt.
        
        if target_lang == 'English':
            lang_instruction = "ENGLISH"
            time_example = "Morning / 9:00 AM"
        else:
            lang_instruction = "JAPANESE (日本語)"
            time_example = "朝 / 9:00"

        system_prompt = f"""
        ### ROLE
        You are a local expert concierge for {category}.
        
        ### CONTEXT
        - Location: {target_city} (Date: {weather_data['date']})
        - Weather: {weather_data['cond']} ({weather_data['temp']}°C)
        - Target Language: {lang_instruction}

        ### LOGIC TREE
        1. **ANALYZE INTENT**:
        - IF GREETING: Ignore weather. Switch to **ONBOARDING MODE**.
        - IF PLANNING REQUEST: Use weather data. Switch to **ITINERARY MODE**.
        - IF FOLLOW-UP: Answer specifically using the context.

        2. **EXECUTE MODE**:
        - **ONBOARDING MODE**: 
          - Title: Polite Greeting Title.
          - Timeline: 3 suggested questions the user can ask next.
        
        - **ITINERARY/ANSWER MODE**: 
          - Title: Short catchy title.
          - Weather Report: A friendly 1-sentence report about the forecast.
          - Timeline: 3 chronological activities or specific answers optimized for weather.

        3. **FORMATTING**:
        - Output strictly in **{lang_instruction}**.
        - Return raw JSON only.

        ### OUTPUT JSON SCHEMA
        {{
            "mode": "greeting" or "itinerary",
            "weather_report": "Specific weather forecast (or null if greeting)",
            "title": "Short title",
            "timeline": [
                {{
                    "time": "Time (Example: '{time_example}')", 
                    "activity": "Activity Name or Question",
                    "description": "Details"
                }}
            ]
        }}
        """

        plan_messages = [{"role": "system", "content": system_prompt}]
        
        # Inject Full History for conversation continuity
        for msg in history:
            plan_messages.append({"role": msg['role'], "content": str(msg['content'])})
            
        plan_messages.append({"role": "user", "content": f"User Input: {user_text}"})

        plan_res = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=plan_messages,
            response_format={"type": "json_object"}
        )
        
        plan_data = json.loads(plan_res.choices[0].message.content)
        
        formatted_points = []
        for item in plan_data.get("timeline", []):
            formatted_points.append(f"{item.get('time')}: {item.get('activity')} - {item.get('description')}")

        return jsonify({
            "city": target_city, 
            "weather": weather_data,
            "report": plan_data.get("weather_report", ""),
            "title": plan_data.get("title", "Suggestion"),
            "points": formatted_points,
            "category": category,
            "user_translation": user_translation
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
    
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)