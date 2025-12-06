# KAZE AI (風)

This repository contains the source code for **KAZE AI**, a context-aware voice concierge that combines ultra-fast generative AI with live weather intelligence to transform simple spoken requests into actionable, weather-proof itineraries.

**Live Link** – https://kaze-ai.vercel.app/

-----

## 🛠 Tech Stack

### Backend: Python (Flask)

- **Groq SDK** – Whisper STT + Llama 3 inference with ultra-low latency on LPUs  
- **Tenacity** – Retry + exponential backoff  
- **Pydantic** – Strict validation for **API inputs**  
- **Flask-CORS** – Secure cross-origin communication  

### Frontend: React (Vite)

- **Firebase (Firestore + Anonymous Auth)** – Persistent chat history  
- **React Leaflet** – Interactive OpenStreetMap rendering inside chat cards  
- **Framer Motion** – Smooth glassmorphic animations  
- **TailwindCSS** – Utility-first responsive styling  
- **Lucide React** – Icons  
- **Axios** – HTTP requests + interceptors  

### External Services

- **Groq API** – Deterministic inference latency  
- **OpenWeatherMap** – 5-Day forecast for grounded itinerary planning  

-----

## ⚙️ Local Setup Instructions

### 1. Prerequisites

- Git  
- Python 3.9+  
- Node.js 18+  
- npm or yarn  

### 2. Clone the Repository

```bash
git clone https://github.com/n3utr7no/Kaze-AI.git
cd Kaze-AI
```

### 3. Backend Setup

```bash
python -m venv venv
source venv/bin/activate       # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Create `.env`:

```env
GROQ_API_KEY=your_groq_api_key
WEATHER_API_KEY=your_openweathermap_api_key
```

### 4. Frontend Setup

```bash
npm install
```

Create `.env`:

```env
VITE_API_URL=http://localhost:5001
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

### 5. Run Dev Servers

**Backend:**

```bash
python app.py
```

**Frontend:**

```bash
npm run dev
```

### 6. Access

http://localhost:5173

-----

## Architecture

### High-Level Context-Aware Pipeline

![Architecture Diagram](arch-diag.png)

-----

## Key Features

### 1. Browser-Agnostic Audio Ingestion

Browsers encode audio differently (Chrome = WebM/Opus, Safari = MP4/AAC).  
The frontend auto-detects format and packages it, and the backend streams it to **Whisper-v3** for accurate Japanese transcription.

![Frontend](frontend.png)

-----

### 2. Agentic Reasoning Pipeline (RAG)

1. **Intent Extraction** – Extract target city + date offset  
2. **Tool Use** – Weather query via OpenWeatherMap  
3. **Context Injection** – Weather is injected into the final system prompt  

This ensures the itinerary is physically accurate and weather-aware.

![Sequence Diagram](sequence-diag.png)

-----

### 3. Stateless Security & Validation

- **Semantic Sanitizer** – Blocks prompt injection attempts  
- **Pydantic Input Validation** – Ensures only structurally valid API inputs reach the pipeline  
- Prevents UI breakage and maintains safety  

-----

### 4. Voice-First & Multilingual

- Japanese/English voice comprehension  
- Whisper-large-v3 transcription  
- Automatic EN ↔ JA translation pipeline  

### 5. Weather-Adaptive Reasoning (RAG)

- Automatically fetches real weather  
- Switches between indoor/outdoor options depending on conditions  

### 6. Dynamic & Reactive UI

- Category-theming for Travel, Fashion, Music, Agriculture, etc.  
- Smooth glassmorphic interface powered by Framer Motion  
- Smart bilingual TTS engine  

-----

## Project Structure

### Frontend (`src/`)

- `App.jsx` – State machine for **idle → recording → transcribing → planning**  
- `components/` – UI cards + reusable widgets  
- `assets/` – Static images + icons  

### Backend (`app.py`)

- Flask API gateway  
- `call_llm()` – Groq wrapper with retry logic  
- `get_weather_forecast()` – External weather retrieval  
- `generate_plan()` – Orchestrates NLU + tools + generation  

-----

## Assumptions & Limitations

### Assumptions

- Geolocation allowed (fallback: Tokyo)  
- "One-shot" planning per request  
- Quiet environments improve STT accuracy  

### Limitations

- Historical context was previously ephemeral (resolved in v2 via Firestore)  
- Complex date expressions may require multiple fallback attempts  
- API rate limits (Groq + OpenWeatherMap)  

-----

## New Features (v2)

### Persistent History (Firebase)
- Firestore stores full chat history per user session  
- Anonymous Auth ensures privacy without onboarding friction  

### Interactive Maps (Leaflet)
- Locations in the itinerary are plotted dynamically  
- Uses OpenStreetMap tiles for high-performance rendering  

### Audio Visualization
- Web Audio API renders lightweight real-time frequency bars  
- Designed for smooth performance on mobile  

### Safety Guardrails
- Semantic Router filters out:
  - coding queries  
  - math  
  - harmful or sensitive topics  
- Only valid concierge-domain queries proceed  

### Bilingual Toggle
- One-click switch: **English ↔ Japanese**  
- UI + generated outputs update instantly  

