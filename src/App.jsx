import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import {
  Mic, RefreshCw, ExternalLink, Languages, Sparkles, Send,
  Plane, Shirt, Music, Sprout, Trophy, Globe, Wind, Info,
  Cloud, CloudRain, CloudSnow, Sun, CloudLightning, Volume2, Square
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Vite environment variable, fallback to localhost for dev
const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:5000';

// --- Configuration & Theming ---
const CATEGORY_THEMES = {
  Travel: { active: 'bg-sky-500 border-sky-500', text: 'text-sky-600', bg: 'bg-sky-50', solid: 'bg-sky-500', icon: 'text-sky-500' },
  Fashion: { active: 'bg-pink-500 border-pink-500', text: 'text-pink-600', bg: 'bg-pink-50', solid: 'bg-pink-500', icon: 'text-pink-500' },
  Music: { active: 'bg-purple-500 border-purple-500', text: 'text-purple-600', bg: 'bg-purple-50', solid: 'bg-purple-500', icon: 'text-purple-500' },
  Agriculture: { active: 'bg-emerald-600 border-emerald-600', text: 'text-emerald-600', bg: 'bg-emerald-50', solid: 'bg-emerald-600', icon: 'text-emerald-600' },
  Sports: { active: 'bg-orange-500 border-orange-500', text: 'text-orange-600', bg: 'bg-orange-50', solid: 'bg-orange-500', icon: 'text-orange-500' },
  General: { active: 'bg-slate-700 border-slate-700', text: 'text-slate-600', bg: 'bg-slate-100', solid: 'bg-slate-600', icon: 'text-slate-400' },
};

const CATEGORIES = [
  { id: 'Travel', icon: <Plane size={16} />, label: 'Travel', ja: '旅行' },
  { id: 'Fashion', icon: <Shirt size={16} />, label: 'Fashion', ja: 'ファッション' },
  { id: 'Music', icon: <Music size={16} />, label: 'Music', ja: '音楽' },
  { id: 'Agriculture', icon: <Sprout size={16} />, label: 'Agriculture', ja: '農業' },
  { id: 'Sports', icon: <Trophy size={16} />, label: 'Sports', ja: 'スポーツ' },
  { id: 'General', icon: <Globe size={16} />, label: 'General', ja: '一般' },
];

const getWeatherIcon = (code) => {
  if (!code) return <Sun size={20} className="text-yellow-500" />;
  if (code.startsWith('01')) return <Sun size={20} className="text-yellow-500" />;
  if (code.startsWith('02') || code.startsWith('03')) return <Cloud size={20} className="text-gray-400" />;
  if (code.startsWith('09') || code.startsWith('10')) return <CloudRain size={20} className="text-blue-500" />;
  if (code.startsWith('11')) return <CloudLightning size={20} className="text-purple-500" />;
  if (code.startsWith('13')) return <CloudSnow size={20} className="text-cyan-300" />;
  return <Wind size={20} className="text-slate-400" />;
};

export default function App() {
  const [appState, setAppState] = useState('idle');
  const [category, setCategory] = useState('Travel');
  const [targetLang, setTargetLang] = useState('English');
  const [transcriptData, setTranscriptData] = useState({ ja: "", en: "" });
  const [inputText, setInputText] = useState("");
  const [playingIndex, setPlayingIndex] = useState(null);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const messagesEndRef = useRef(null);
  const [userLocation, setUserLocation] = useState(null);

  const [chatHistory, setChatHistory] = useState([
    {
      type: 'bot',
      isWelcome: true,
      data: {
        title: "Welcome to KAZE AI",
        city: "System",
        weather: { temp: "--", icon_code: "" },
        category: "General",
        points: [
          "Select a category below",
          "Tap the Mic to speak",
          "Or type your question directly"
        ]
      }
    }
  ]);

  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          console.log("📍 GPS SUCCESS:", position.coords.latitude, position.coords.longitude);
          setUserLocation({
            lat: position.coords.latitude,
            lon: position.coords.longitude
          });
        },
        (error) => console.log("📍 GPS DENIED:", error)
      );
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, appState]);

  // Update Welcome message when language toggles
  useEffect(() => {
    setChatHistory(prev => {
      const newHistory = [...prev];
      if (newHistory.length > 0 && newHistory[0].isWelcome) {
        newHistory[0] = {
          ...newHistory[0],
          data: {
            ...newHistory[0].data,
            title: targetLang === 'English' ? "Welcome to KAZE AI" : "KAZE AIへようこそ",
            city: targetLang === 'English' ? "System" : "システム",
            points: targetLang === 'English'
              ? ["Select a category below", "Tap Mic to speak", "Or type directly"]
              : ["下のカテゴリーを選択してください", "マイクをタップして話す", "または直接入力してください"]
          }
        };
      }
      return newHistory;
    });
  }, [targetLang]);

  // --- Audio Recording & Processing ---

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Detect MIME type to support Safari (mp4) vs Chrome/Firefox (webm)
      let mimeType = 'audio/webm';
      if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4';
      } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
        mimeType = 'audio/ogg';
      }

      console.log(`Using MIME type: ${mimeType}`);

      mediaRecorderRef.current = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorderRef.current.onstop = () => handleStopAndTranscribe(mimeType);
      mediaRecorderRef.current.start();
      setAppState('recording');

    } catch (err) {
      console.error("Mic Error:", err);
      alert("Microphone Access Denied or Not Supported.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && appState === 'recording') {
      mediaRecorderRef.current.stop();
      // Crucial: Stop all tracks to release the browser's "recording" indicator/lock
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const handleMicClick = () => {
    if (appState === 'recording') {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const handleStopAndTranscribe = async (mimeType) => {
    const blob = new Blob(audioChunksRef.current, { type: mimeType });
    if (blob.size === 0) {
      console.warn("Audio was empty. Recording too short?");
      setAppState('idle');
      return;
    }

    setAppState('transcribing');

    const formData = new FormData();
    // Hint extension to backend (Whisper) for easier processing
    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
    formData.append('audio', blob, `voice.${ext}`);

    try {
      const res = await axios.post(`${API_URL}/transcribe`, formData);
      setTranscriptData({ ja: res.data.transcript, en: res.data.translation });
      setAppState('verification');
    } catch (error) {
      console.error("Transcription Failed:", error);
      alert("Transcription failed. See console.");
      setAppState('idle');
    }
  };

  // --- Text-to-Speech ---

  const toggleAudio = (text, index) => {
    // If clicking the actively playing message, stop it
    if (playingIndex === index) {
      window.speechSynthesis.cancel();
      setPlayingIndex(null);
      return;
    }

    // Otherwise, play new (browser automatically queues/interrupts based on implementation)
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = targetLang === 'English' ? 'en-US' : 'ja-JP';
    utterance.rate = 1.0;

    utterance.onend = () => setPlayingIndex(null);
    utterance.onerror = () => setPlayingIndex(null);

    setPlayingIndex(index);
    window.speechSynthesis.speak(utterance);
  };

  // --- Plan Generation Logic ---

  const executePlanGeneration = async (textInput, isVoice = false) => {
    setAppState('planning');

    // Context management: Filter out welcome msg and keep only last 6 turns to manage token usage
    const historyContext = chatHistory
      .filter(msg => !msg.isWelcome)
      .slice(-6)
      .map(msg => ({
        role: msg.type === 'user' ? 'user' : 'assistant',
        content: msg.type === 'user' ? msg.main : JSON.stringify(msg.data)
      }));

    try {
      const res = await axios.post(`${API_URL}/generate_plan`, {
        text: textInput,
        category: category,
        language: targetLang,
        history: historyContext,
        user_location: userLocation
      });

      const data = res.data;

      // If text input, update the temporary subtitle with the actual translation received
      if (!isVoice) {
        setChatHistory(prev => {
          const newHistory = [...prev];
          const lastMsgIndex = newHistory.length - 1;
          if (lastMsgIndex >= 0 && newHistory[lastMsgIndex].type === 'user') {
            newHistory[lastMsgIndex] = {
              ...newHistory[lastMsgIndex],
              sub: data.user_translation
            };
          }
          return newHistory;
        });
      }

      const botMsg = {
        type: 'bot',
        data: {
          city: data.city,
          weather: data.weather,
          intro: data.intro,
          report: data.report,
          title: data.title,
          points: data.points,
          category: data.category
        }
      };

      setChatHistory(prev => [...prev, botMsg]);

      setAppState('idle');
      setTranscriptData({ ja: "", en: "" });

    } catch (error) {
      console.error(error);
      alert("Planning failed. Is backend running?");
      setAppState('idle');
    }
  };

  const handleConfirmVoice = () => {
    const mainText = targetLang === 'English' ? transcriptData.en : transcriptData.ja;
    const subText = targetLang === 'English' ? transcriptData.ja : transcriptData.en;

    const userMsg = { type: 'user', main: mainText, sub: subText, isVoice: true };
    setChatHistory(prev => [...prev, userMsg]);
    executePlanGeneration(transcriptData.ja, true);
  };

  const handleTextSubmit = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const userMsg = { type: 'user', main: inputText, sub: "Translating...", isVoice: false };
    setChatHistory(prev => [...prev, userMsg]);

    executePlanGeneration(inputText, false);
    setInputText("");
  };

  const handleRetry = () => {
    setTranscriptData({ ja: "", en: "" });
    setAppState('idle');
  };

  const isWelcome = chatHistory.length === 1;

  return (
    <div className="min-h-screen w-full bg-[#f3f4f6] relative overflow-hidden font-sans selection:bg-indigo-500 selection:text-white flex items-center justify-center p-4 sm:p-8">

      {/* Background Blobs */}
      <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-purple-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob"></div>
      <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-sky-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-2000"></div>

      <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-12 items-center relative z-10">

        {/* LEFT COLUMN: Hero / Info */}
        <div className="flex lg:hidden flex-col gap-4 text-slate-800 mb-6 px-2">
          <div>
            <h1 className="text-6xl font-black tracking-tighter leading-[1.1] mb-4">
              Navigate the world <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-sky-500">
                At the Speed of Voice.
              </span>
            </h1>
            <p className="text-lg text-slate-600 max-w-md leading-relaxed">
              KAZE (風) is your intelligent companion. By fusing live weather data with generative AI, it turns your spoken words into adaptive, hyper-local itineraries instantly.
            </p>
          </div>
        </div>

        <div className="hidden lg:flex flex-col gap-6 text-slate-800">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-slate-200 shadow-sm mb-4">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Live Demo</span>
            </div>
            <h1 className="text-6xl font-black tracking-tighter leading-[1.1] mb-4">
              Navigate the world <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-sky-500">
                At the Speed of Voice.
              </span>
            </h1>
            <p className="text-lg text-slate-600 max-w-md leading-relaxed">
              KAZE (風) is your intelligent companion. By fusing live weather data with generative AI, it turns your spoken words into adaptive, hyper-local itineraries instantly.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {['React', 'Flask', 'Whisper AI', 'Llama 3', 'OpenWeather'].map(tech => (
              <span key={tech} className="px-3 py-1.5 bg-white/60 border border-slate-200 rounded-lg text-xs font-bold text-slate-600">
                {tech}
              </span>
            ))}
          </div>
        </div>

        {/* RIGHT COLUMN: App Interface */}
        <div className="w-full lg:flex lg:justify-center">
          <div className="w-full sm:max-w-md mx-auto h-[100dvh] sm:h-[800px] bg-white sm:rounded-[32px] shadow-2xl relative flex flex-col overflow-hidden ring-8 ring-white ring-opacity-40 backdrop-blur-xl">

            {/* Header */}
            <header className="bg-white/80 backdrop-blur-xl border-b border-slate-200/60 p-4 flex justify-between items-center z-20 sticky top-0 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl flex items-center justify-center text-white shadow-lg shadow-slate-200 ring-1 ring-slate-900/5">
                  <Wind size={20} className="animate-pulse-slow" />
                </div>
                <div className="flex flex-col">
                  <h1 className="font-bold text-xl text-slate-900 tracking-tight leading-none">
                    KAZE <span className="text-slate-400 font-light">AI</span>
                  </h1>
                  <div className="flex items-center gap-1 mt-1">
                    <span className="w-1 h-1 rounded-full bg-emerald-500"></span>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                      Contextual Assistant
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-end">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 mr-1 opacity-80">
                  Output Language
                </span>
                <div className="flex bg-slate-100/80 rounded-lg p-1 border border-slate-200">
                  <button onClick={() => setTargetLang('English')} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all duration-200 ${targetLang === 'English' ? 'bg-white shadow-sm text-slate-900 ring-1 ring-black/5' : 'text-slate-400 hover:text-slate-600'}`}>EN</button>
                  <button onClick={() => setTargetLang('Japanese')} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all duration-200 ${targetLang === 'Japanese' ? 'bg-white shadow-sm text-slate-900 ring-1 ring-black/5' : 'text-slate-400 hover:text-slate-600'}`}>JP</button>
                </div>
              </div>
            </header>

            {/* Chat Stream */}
            <main
              className={`
              flex-1 overflow-y-auto p-4 space-y-6 scrollbar-hide relative z-10 bg-slate-50/50 flex flex-col justify-start pb-56
              ${isWelcome
                  ? 'flex items-center justify-center pb-0 mb-48'
                  : 'flex flex-col justify-start items-center pb-56'
                }`}>
              <AnimatePresence mode="popLayout">
                {chatHistory.map((msg, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex w-full ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {/* User Message Bubble */}
                    {msg.type === 'user' && (
                      <div className="flex flex-col items-end max-w-[80%]">
                        <div className="bg-slate-800 text-white px-5 py-3 rounded-2xl rounded-tr-none shadow-md text-sm md:text-base">
                          {msg.main}
                        </div>
                        {msg.sub && (
                          <span className="text-[10px] text-slate-400 mt-1 mr-1 italic">{msg.sub}</span>
                        )}
                      </div>
                    )}

                    {/* Bot/Response Card */}
                    {msg.type === 'bot' && (
                      <div className={`w-full ${msg.isWelcome ? 'max-w-[85%]' : 'max-w-[85%] mr-auto'}`}>
                        <div className="bg-white rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-slate-100 relative overflow-hidden">

                          <div className={`absolute top-0 left-0 w-full h-1.5 ${CATEGORY_THEMES[msg.data.category]?.solid || 'bg-slate-200'}`} />

                          {/* Card Header & Weather Badge */}
                          <div className="flex justify-between items-start gap-4 mb-4">
                            <div className="flex-1">
                              <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider mb-2 ${CATEGORY_THEMES[msg.data.category]?.bg} ${CATEGORY_THEMES[msg.data.category]?.text}`}>
                                <Sparkles size={10} />
                                {CATEGORIES.find(c => c.id === msg.data.category)
                                  ? (targetLang === 'English' ? CATEGORIES.find(c => c.id === msg.data.category).label : CATEGORIES.find(c => c.id === msg.data.category).ja)
                                  : msg.data.category}
                              </div>
                              <h2 className="text-xl font-bold text-slate-900 leading-tight">{msg.data.title}</h2>
                            </div>

                            {!msg.isWelcome && (
                              <div className="flex flex-col items-center justify-center bg-slate-50/80 backdrop-blur-sm rounded-2xl p-2.5 min-w-[70px] border border-slate-100">
                                <div className={CATEGORY_THEMES[msg.data.category]?.text}>
                                  {getWeatherIcon(msg.data.weather.icon_code)}
                                </div>
                                <div className="text-lg font-bold text-slate-700 mt-1 leading-none">{msg.data.weather.temp}°</div>
                                <div className="text-[9px] font-bold text-slate-400 uppercase mt-0.5 tracking-wide">{msg.data.city}</div>
                              </div>
                            )}
                          </div>

                          {/* Report Summary */}
                          {msg.data.report && (
                            <div className="mb-5 bg-slate-50 p-3.5 rounded-xl border border-slate-100 flex gap-3 items-start">
                              <div className={`mt-0.5 ${CATEGORY_THEMES[msg.data.category]?.text}`}>
                                <Info size={16} />
                              </div>
                              <p className="text-xs text-slate-600 font-medium leading-relaxed">
                                {msg.data.report}
                              </p>
                            </div>
                          )}

                          {/* Points List */}
                          <ul className="space-y-3 mb-5">
                            {msg.data.points.map((p, i) => (
                              <li key={i} className="flex items-start gap-3 text-sm text-slate-600 leading-relaxed group">
                                <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${CATEGORY_THEMES[msg.data.category]?.solid} opacity-60 group-hover:opacity-100`}></span>
                                {p}
                              </li>
                            ))}
                          </ul>

                          {/* Card Footer */}
                          <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                            <button
                              onClick={() => {
                                // Gather all meaningful text parts for TTS
                                const contentParts = [
                                  msg.data.title,
                                  msg.data.report,
                                  (msg.data.points || []).join('. ')
                                ];
                                const fullText = contentParts.filter(Boolean).join('. ');
                                toggleAudio(fullText, idx);
                              }}
                              className={`p-2 rounded-full transition-colors ${playingIndex === idx
                                ? 'bg-slate-900 text-white hover:bg-slate-800'
                                : 'hover:bg-slate-100 text-slate-400 hover:text-slate-600'
                                }`}
                              title={playingIndex === idx ? "Stop Voice" : "Read Response"}
                            >
                              {playingIndex === idx ? <Square size={12} fill="currentColor" /> : <Volume2 size={16} />}
                            </button>

                            {!msg.isWelcome && (
                              <a
                                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(msg.data.city + ' ' + msg.data.title)}`}
                                target="_blank"
                                rel="noreferrer"
                                className={`inline-flex items-center gap-1.5 text-xs font-bold transition-colors hover:opacity-80 ${CATEGORY_THEMES[msg.data.category]?.text}`}
                              >
                                {targetLang === 'English' ? 'Open Map' : '地図を開く'} <ExternalLink size={12} />
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
              <div ref={messagesEndRef} />
            </main>

            {/* Input Controller Area */}
            <div className="absolute bottom-0 w-full bg-gradient-to-t from-white via-white/95 to-transparent pt-4 pb-6 px-4 z-30 flex flex-col items-center">

              {/* Voice Verification Modal */}
              <AnimatePresence>
                {appState === 'verification' && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
                    className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-4 mb-4 shadow-xl"
                  >
                    <div className="flex items-center gap-2 mb-2 text-slate-400 text-[10px] font-bold uppercase tracking-wider">
                      <Languages size={12} /> Voice Input Detected
                    </div>
                    <div className="mb-4">
                      <p className="text-base font-bold text-slate-900 leading-snug">
                        "{targetLang === 'English' ? transcriptData.en : transcriptData.ja}"
                      </p>
                      <p className="text-sm text-slate-400 italic mt-1">
                        {targetLang === 'English' ? transcriptData.ja : transcriptData.en}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={handleRetry} className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-bold text-slate-600">Retry</button>
                      <button onClick={handleConfirmVoice} className="flex-1 py-2 bg-slate-900 hover:bg-slate-800 rounded-lg text-xs font-bold text-white shadow-md">
                        Generate
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Main Input Controls */}
              {appState !== 'verification' && (
                <div className="w-full max-w-lg flex flex-col gap-3">
                  <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide mask-fade">
                    {CATEGORIES.map((cat) => (
                      <button
                        key={cat.id}
                        onClick={() => setCategory(cat.id)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-full whitespace-nowrap text-xs font-bold transition-all border ${category === cat.id
                          ? `${CATEGORY_THEMES[cat.id].active} text-white shadow-md`
                          : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                          }`}
                      >
                        {cat.icon}
                        {targetLang === 'English' ? cat.label : cat.ja}
                      </button>
                    ))}
                  </div>

                  <div className="relative flex items-center gap-2 bg-white border border-slate-200 rounded-2xl p-2 shadow-lg shadow-slate-200/50">
                    <form onSubmit={handleTextSubmit} className="flex-1 flex items-center">
                      <input
                        type="text"
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        placeholder={
                          appState === 'transcribing'
                            ? (targetLang === 'English' ? "Processing Voice..." : "音声処理中...")
                            : appState === 'planning'
                              ? (targetLang === 'English' ? "Designing Plan..." : "プラン作成中...")
                              : (targetLang === 'English'
                                ? `Ask about ${CATEGORIES.find(c => c.id === category).label}...`
                                : `${CATEGORIES.find(c => c.id === category).ja}について聞く...`)
                        }
                        disabled={appState !== 'idle'}
                        className="w-full bg-transparent border-none outline-none focus:ring-0 focus:outline-none text-sm px-3 text-slate-800 placeholder:text-slate-400"
                      />
                    </form>

                    {inputText.trim().length > 0 ? (
                      <button onClick={handleTextSubmit} disabled={appState !== 'idle'} className="p-3 rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-all shadow-md">
                        <Send size={20} />
                      </button>
                    ) : (
                      (appState === 'transcribing' || appState === 'planning') ? (
                        <div className="p-3 rounded-xl bg-slate-100 text-slate-400 w-12 flex items-center justify-center">
                          <RefreshCw size={20} className="animate-spin" />
                        </div>
                      ) : (
                        <button
                          onClick={handleMicClick}
                          disabled={appState !== 'idle' && appState !== 'recording'}
                          className={`p-3 rounded-xl transition-all duration-200 shadow-md flex items-center justify-center
                              ${appState === 'recording' ? 'bg-red-500 text-white shadow-red-200 w-12' : 'bg-slate-900 text-white hover:bg-slate-800 w-12'}
                              ${(appState !== 'idle' && appState !== 'recording') ? 'opacity-50 cursor-not-allowed' : ''}
                            `}
                        >
                          {appState === 'recording' ? <span className="animate-pulse w-3 h-3 bg-white rounded-sm"></span> : <Mic size={20} />}
                        </button>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 