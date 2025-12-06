import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import {
  Mic, RefreshCw, ExternalLink, Languages, Sparkles, Send,
  Plane, Shirt, Music, Sprout, Trophy, Globe, Wind, Info,
  Cloud, CloudRain, CloudSnow, Sun, CloudLightning, Volume2, StopCircle,
  Trash2, AlertTriangle
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';

// --- FIREBASE IMPORTS ---
import { initializeApp } from 'firebase/app';
import { getAnalytics } from "firebase/analytics";
import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
  onAuthStateChanged
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  deleteDoc,
  updateDoc,
  doc,
  serverTimestamp,
  getDocs
} from 'firebase/firestore';

// --- LEAFLET FIX ---
try {
  // eslint-disable-next-line
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  });
} catch (e) {
  console.warn("Leaflet icon fix failed:", e);
}

// --- FIREBASE SETUP ---
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

let app, auth, db, analytics;
let firebaseError = null;

try {
  if (!firebaseConfig.apiKey) throw new Error("Missing API Key in .env");
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  analytics = typeof window !== 'undefined' ? getAnalytics(app) : null;
} catch (e) {
  console.error("Firebase Init Error:", e);
  firebaseError = e.message;
}

const appId = 'kaze-v2-stable';
const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:5001';

// --- THEME CONFIG ---
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
  if (firebaseError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-red-50 text-red-800 p-8">
        <div className="max-w-md text-center">
          <AlertTriangle size={48} className="mx-auto mb-4 text-red-500" />
          <h1 className="text-2xl font-bold mb-2">Configuration Error</h1>
          <code className="bg-red-100 p-2 rounded block text-xs text-left mb-4 break-all">{firebaseError}</code>
          <p className="text-sm">Check your <b>.env</b> file.</p>
        </div>
      </div>
    );
  }

  // --- STATE ---
  const [appState, setAppState] = useState('idle');
  const [category, setCategory] = useState('Travel');
  const [targetLang, setTargetLang] = useState('English');
  const [transcriptData, setTranscriptData] = useState({ ja: "", en: "" });
  const [inputText, setInputText] = useState("");
  const [playingIndex, setPlayingIndex] = useState(null);
  const [user, setUser] = useState(null);
  const [chatHistory, setChatHistory] = useState([]); const [notification, setNotification] = useState(null);
  const [showClearModal, setShowClearModal] = useState(false);

  // --- REFS ---
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const messagesEndRef = useRef(null);
  const [userLocation, setUserLocation] = useState(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);
  const visualizerBarsRef = useRef([]);

  const showNotification = (message, type = 'error') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000); // Auto-hide after 3s
  };

  // --- EFFECT 1: AUTHENTICATION ---
  useEffect(() => {
    if (!auth) return;
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (e) {
        console.error("Auth Error:", e);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // --- EFFECT 2: FIRESTORE SYNC (With Sanitizer) ---
  useEffect(() => {
    if (!user || !db) return;

    const historyRef = collection(db, 'artifacts', appId, 'users', user.uid, 'chat_history');
    const q = query(historyRef, orderBy('createdAt', 'asc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const history = snapshot.docs.map(doc => {
        const raw = doc.data();

        // 1. SAFETY HELPER: Force value to string if it's an object
        const safeString = (val) => {
          if (val === null || val === undefined) return "";
          if (typeof val === 'string') return val;
          if (typeof val === 'object') {
            // If we accidentally saved {en, ja} object here, pick English or stringify
            return val.en || val.ja || JSON.stringify(val);
          }
          return String(val);
        };

        // 2. SANITIZE USER MESSAGES
        if (raw.type === 'user') {
          return {
            id: doc.id,
            ...raw,
            main: safeString(raw.main),
            sub: safeString(raw.sub)
          };
        }

        // 3. SANITIZE BOT MESSAGES
        const rawContent = raw.data?.content || {};
        const safeContent = {
          en: {
            title: safeString(rawContent.en?.title),
            report: safeString(rawContent.en?.report),
            // Ensure timeline_data is an array
            timeline_data: Array.isArray(rawContent.en?.timeline_data)
              ? rawContent.en.timeline_data.map(t => ({
                text: safeString(t.text),
                coords: Array.isArray(t.coords) && t.coords.length === 2 ? t.coords : null,
                name: safeString(t.name)
              }))
              : []
          },
          ja: {
            title: safeString(rawContent.ja?.title),
            report: safeString(rawContent.ja?.report),
            timeline_data: Array.isArray(rawContent.ja?.timeline_data)
              ? rawContent.ja.timeline_data.map(t => ({
                text: safeString(t.text),
                coords: Array.isArray(t.coords) && t.coords.length === 2 ? t.coords : null,
                name: safeString(t.name)
              }))
              : []
          }
        };

        return {
          id: doc.id,
          ...raw,
          data: {
            ...raw.data,
            city: safeString(raw.data?.city),
            content: safeContent
          }
        };
      });

      if (history.length === 0) {
        addDoc(historyRef, {
          type: 'bot',
          isWelcome: true,
          displayLang: 'English',
          createdAt: serverTimestamp(),
          data: {
            category: "General",
            weather: { temp: "--", icon_code: "" },
            city: "System",
            content: {
              en: {
                title: "Welcome to KAZE AI",
                report: "I am ready to help.",
                timeline_data: [
                  { text: "Select a category below", coords: null },
                  { text: "Tap the Mic to speak", coords: null },
                  { text: "Or type your question directly", coords: null }
                ]
              },
              ja: {
                title: "KAZE AIへようこそ",
                report: "準備完了しました。",
                timeline_data: [
                  { text: "下のカテゴリーを選択してください", coords: null },
                  { text: "マイクをタップして話す", coords: null },
                  { text: "または直接入力してください", coords: null }
                ]
              }
            }
          }
        });
      } else {
        setChatHistory(history);
      }
    }, (err) => console.error("Firestore Error:", err));

    return () => unsubscribe();
  }, [user]);

  // --- EFFECT 3: GEOLOCATION ---
  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lon: position.coords.longitude
          });
        },
        (error) => console.log("GPS Error:", error)
      );
    }
  }, []);

  // --- EFFECT 4: SCROLLING ---
  useEffect(() => {
    if (chatHistory.length > 1) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatHistory, appState]);

  // --- EFFECT 5: SYNC WELCOME MESSAGE LANG ---
  useEffect(() => {
    setChatHistory(prev => {
      const newHistory = [...prev];
      if (newHistory.length > 0 && newHistory[0].isWelcome) {
        newHistory[0] = {
          ...newHistory[0],
          displayLang: targetLang
        };
      }
      return newHistory;
    });
  }, [targetLang]);

  // --- AUDIO LOGIC ---
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let mimeType = 'audio/webm';
      if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
      else if (MediaRecorder.isTypeSupported('audio/ogg')) mimeType = 'audio/ogg';

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 32;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;

      const animate = () => {
        if (!analyserRef.current) return;
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);
        const indexes = [1, 2, 3, 4, 5];
        indexes.forEach((freqIndex, i) => {
          const bar = visualizerBarsRef.current[i];
          if (bar) {
            const value = dataArray[freqIndex] || 0;
            const height = Math.max(4, (value / 255) * 24);
            bar.style.height = `${height}px`;
          }
        });
        animationFrameRef.current = requestAnimationFrame(animate);
      };
      animate();

      mediaRecorderRef.current = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorderRef.current.onstop = () => handleStopAndTranscribe(mimeType);
      mediaRecorderRef.current.start();
      setAppState('recording');
    } catch (err) {
      console.error("Mic Error:", err);
      showNotification("Microphone Access Denied.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && appState === 'recording') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    }
  };

  const handleMicClick = () => {
    if (appState === 'recording') stopRecording();
    else startRecording();
  };

  const handleStopAndTranscribe = async (mimeType) => {
    const blob = new Blob(audioChunksRef.current, { type: mimeType });
    if (blob.size === 0) {
      setAppState('idle');
      return;
    }
    setAppState('transcribing');
    const formData = new FormData();
    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
    formData.append('audio', blob, `voice.${ext}`);

    try {
      const res = await axios.post(`${API_URL}/transcribe`, formData);
      setTranscriptData({ ja: res.data.transcript, en: res.data.translation });
      setAppState('verification');
    } catch (error) {
      console.error("Transcription Failed:", error);
      showNotification("Transcription failed.");
      setAppState('idle');
    }
  };

  // --- ACTIONS ---
  const handleClearHistory = async () => {
    if (!user || !db) return;
    const historyRef = collection(db, 'artifacts', appId, 'users', user.uid, 'chat_history');
    const snapshot = await getDocs(historyRef);
    snapshot.docs.forEach(async (docSnapshot) => {
      await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'chat_history', docSnapshot.id));
    });
    setChatHistory([]);
  };

  const toggleCardLanguage = async (index) => {
    const msg = chatHistory[index];
    if (!msg) return;

    const newLang = msg.displayLang === 'English' ? 'Japanese' : 'English';

    if (msg.id && user && db) {
      const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'chat_history', msg.id);
      await updateDoc(docRef, { displayLang: newLang });
    } else {
      setChatHistory(prev => {
        const newHistory = [...prev];
        newHistory[index] = { ...msg, displayLang: newLang };
        return newHistory;
      });
    }
  };

  const toggleAudio = (text, lang, idx) => {
    window.speechSynthesis.cancel();
    if (playingIndex === idx) {
      setPlayingIndex(null);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang === 'English' ? 'en-US' : 'ja-JP';
    utterance.rate = lang === 'Japanese' ? 0.9 : 1.0;
    utterance.pitch = 1.0;
    utterance.onend = () => setPlayingIndex(null);
    setPlayingIndex(idx);
    window.speechSynthesis.speak(utterance);
  };

  const executePlanGeneration = async (textInput, isVoice = false) => {
    if (!user || !db) return;
    setAppState('planning');
    const historyRef = collection(db, 'artifacts', appId, 'users', user.uid, 'chat_history');

    let userDocRef = null;
    try {
      const docRef = await addDoc(historyRef, {
        type: 'user',
        main: textInput,
        sub: "Translating...",
        isVoice: isVoice,
        createdAt: serverTimestamp()
      });
      userDocRef = docRef;
    } catch (e) {
      console.error("Error adding user message:", e);
      setAppState('idle');
      return;
    }

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

      if (!isVoice && userDocRef) {
        await updateDoc(userDocRef, { sub: data.user_translation });
      }

      await addDoc(historyRef, {
        type: 'bot',
        displayLang: targetLang,
        createdAt: serverTimestamp(),
        data: {
          city: data.city,
          weather: data.weather,
          category: data.category,
          content: data.content
        }
      });

      setAppState('idle');
      setTranscriptData({ ja: "", en: "" });

    } catch (error) {
      console.error(error);
      showNotification("Planning failed. Check console.");
      setAppState('idle');

      await addDoc(historyRef, {
        type: 'bot',
        displayLang: 'English',
        createdAt: serverTimestamp(),
        data: {
          category: "System",
          weather: { temp: "!", icon_code: "" },
          city: "Error",
          content: {
            en: { title: "Error", report: "Could not generate plan.", timeline_data: [] },
            ja: { title: "エラー", report: "プランを作成できませんでした。", timeline_data: [] }
          }
        }
      });
    }
  };

  const handleConfirmVoice = () => {
    const mainText = targetLang === 'English' ? transcriptData.en : transcriptData.ja;
    const subText = targetLang === 'English' ? transcriptData.ja : transcriptData.en;
    executePlanGeneration(transcriptData.ja, true);
  };

  const handleTextSubmit = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    executePlanGeneration(inputText, false);
    setInputText("");
  };

  const handleRetry = () => {
    setTranscriptData({ ja: "", en: "" });
    setAppState('idle');
  };

  const isWelcome = chatHistory.length <= 1;

  // --- RENDER ---
  return (
    <div className="min-h-screen w-full bg-[#f3f4f6] relative overflow-hidden font-sans selection:bg-indigo-500 selection:text-white flex items-center justify-center p-4 sm:p-8">

      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="fixed top-6 left-6 z-50 px-4 py-3 rounded-xl shadow-xl border bg-red-50 border-red-100 text-red-600 flex items-center gap-3 min-w-[200px]"
          >
            <div className="bg-red-100 p-1.5 rounded-full">
              <AlertTriangle size={14} className="text-red-500" />
            </div>
            <span className="text-xs font-bold tracking-wide">{notification.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-sky-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-2000"></div>

      <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-12 items-center relative z-10">

        {/* MOBILE HERO */}
        <div className="flex lg:hidden flex-col gap-4 text-slate-800 mb-6 px-2 text-center items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-slate-200 shadow-sm mb-4">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Live Demo</span>
            </div>
            <h1 className="text-4xl font-black tracking-tighter leading-[1.1] mb-4">
              {targetLang === 'English' ? (
                <>Your everyday<br /><span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-sky-500">pocket concierge.</span></>
              ) : (
                <>あなたのポケットに、<br /><span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-sky-500">専属コンシェルジュを。</span></>
              )}
            </h1>
            <p className="text-base text-slate-600 max-w-md leading-relaxed mx-auto">
              {targetLang === 'English'
                ? "Speak naturally, and KAZE (風) will handle the rest. By combining generative AI with live weather intelligence, it transforms a simple question into a tailored, weather-proof adventure."
                : "自然に話しかけるだけで、あとはKAZEにお任せ。生成AIとリアルタイム気象データを融合し、あなたの質問を天候に最適化された特別な体験へと変えます。"
              }
            </p>
          </div>
        </div>

        {/* DESKTOP HERO */}
        <div className="hidden lg:flex flex-col gap-6 text-slate-800 text-left items-start">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-slate-200 shadow-sm mb-4">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Live Demo</span>
            </div>
            <h1 className="text-6xl font-black tracking-tighter leading-[1.1] mb-4">
              {targetLang === 'English' ? (
                <>Your everyday<br /><span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-sky-500">pocket concierge.</span></>
              ) : (
                <>あなたのポケットに、<br /><span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-sky-500">専属コンシェルジュを。</span></>
              )}
            </h1>
            <p className="text-lg text-slate-600 max-w-md leading-relaxed">
              {targetLang === 'English'
                ? "Speak naturally, and KAZE (風) will handle the rest. By combining generative AI with live weather intelligence, it transforms a simple question into a tailored, weather-proof adventure."
                : "自然に話しかけるだけで、あとはKAZEにお任せ。生成AIとリアルタイム気象データを融合し、あなたの質問を天候に最適化された特別な体験へと変えます。"
              }
            </p>
          </div>
        </div>

        {/* APP INTERFACE */}
        <div className="w-full lg:flex lg:justify-center">
          <div className="w-full sm:max-w-md mx-auto h-[100dvh] sm:h-[800px] bg-white sm:rounded-[32px] shadow-2xl relative flex flex-col overflow-hidden ring-8 ring-white ring-opacity-40 backdrop-blur-xl">

            {/* HEADER */}
            <header className="bg-white/80 backdrop-blur-xl border-b border-slate-200/60 p-4 flex justify-between items-center z-20 sticky top-0 shadow-sm transition-all">
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
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Contextual Assistant</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4">

                {/* LANGUAGE TOGGLE GROUP */}
                <div className="flex flex-col items-end">
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 mr-1 opacity-80">
                    Language / 言語
                  </span>
                  <div className="flex bg-slate-100/80 rounded-lg p-1 border border-slate-200 h-[42px] items-center">
                    <button
                      onClick={() => setTargetLang('English')}
                      className={`min-w-[40px] px-2 py-1 rounded-md transition-all duration-200 flex flex-col items-center justify-center ${targetLang === 'English' ? 'bg-white shadow-sm text-slate-900 ring-1 ring-black/5' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                      <span className="text-xs font-bold leading-none mb-0.5">EN</span>
                      <span className="text-[8px] font-normal opacity-70 leading-none transform scale-90">英語</span>
                    </button>
                    <button
                      onClick={() => setTargetLang('Japanese')}
                      className={`min-w-[40px] px-2 py-1 rounded-md transition-all duration-200 flex flex-col items-center justify-center ${targetLang === 'Japanese' ? 'bg-white shadow-sm text-slate-900 ring-1 ring-black/5' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                      <span className="text-xs font-bold leading-none mb-0.5">JP</span>
                      <span className="text-[8px] font-normal opacity-70 leading-none transform scale-90">日本語</span>
                    </button>
                  </div>
                </div>
              </div>
            </header>

            {/* CHAT STREAM */}
            <main className={`flex-1 overflow-y-auto px-4 pt-4 space-y-6 scrollbar-hide relative z-10 bg-slate-50/50 flex flex-col justify-start pb-56 ${isWelcome ? 'items-center' : 'items-center'}`}>
              <AnimatePresence mode="popLayout">
                {chatHistory.map((msg, idx) => (
                  <motion.div
                    key={msg.id || idx}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex w-full ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {/* USER MSG */}
                    {msg.type === 'user' && (
                      <div className="flex flex-col items-end max-w-[80%]">
                        <div className="bg-slate-800 text-white px-5 py-3 rounded-2xl rounded-tr-none shadow-md text-sm md:text-base">
                          {msg.main}
                        </div>
                        {msg.sub && <span className="text-[10px] text-slate-400 mt-1 mr-1 italic">{msg.sub}</span>}
                      </div>
                    )}

                    {/* BOT CARD */}
                    {msg.type === 'bot' && (
                      <div className={`w-full ${msg.isWelcome ? 'max-w-[85%]' : 'max-w-[85%] mr-auto'}`}>
                        <div className="bg-white rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-slate-100 relative overflow-hidden group">

                          <div className={`absolute top-0 left-0 w-full h-1.5 ${CATEGORY_THEMES[msg.data.category]?.solid || 'bg-slate-200'}`} />

                          {(() => {
                            const langKey = msg.displayLang === 'English' ? 'en' : 'ja';
                            // Safe check for undefined content (prevents crash on old data or sync delay)
                            const content = msg.data.content?.[langKey] || { title: "Loading...", report: "", timeline_data: [] };
                            const toggleLabel = msg.displayLang === 'English' ? '日本語' : 'English';

                            return (
                              <>
                                <div className="flex justify-between items-start gap-4 mb-4">
                                  <div className="flex-1">
                                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider mb-2 ${CATEGORY_THEMES[msg.data.category]?.bg} ${CATEGORY_THEMES[msg.data.category]?.text}`}>
                                      <Sparkles size={10} />
                                      {CATEGORIES.find(c => c.id === msg.data.category)
                                        ? (msg.displayLang === 'English' ? CATEGORIES.find(c => c.id === msg.data.category).label : CATEGORIES.find(c => c.id === msg.data.category).ja)
                                        : msg.data.category}
                                    </div>
                                    <h2 className="text-xl font-bold text-slate-900 leading-tight">{content.title}</h2>
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

                                {content.report && (
                                  <div className="mb-5 bg-slate-50 p-3.5 rounded-xl border border-slate-100 flex gap-3 items-start">
                                    <div className={`mt-0.5 ${CATEGORY_THEMES[msg.data.category]?.text}`}>
                                      <Info size={16} />
                                    </div>
                                    <p className="text-xs text-slate-600 font-medium leading-relaxed">{content.report}</p>
                                  </div>
                                )}

                                {/* Timeline / Points */}
                                <ul className="space-y-3 mb-5">
                                  {content.timeline_data?.map((item, i) => (
                                    <li key={i} className="flex items-start gap-3 text-sm text-slate-600 leading-relaxed group">
                                      {/* FIXED: Changed mt-1.5 to mt-2.5 to perfectly center dot with the first line of text */}
                                      <span className={`mt-2.5 w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${CATEGORY_THEMES[msg.data.category]?.solid} opacity-60 group-hover:opacity-100`}></span>

                                      {/* FIXED: Added clean regex to remove redundant hyphens from backend text */}
                                      <span className="flex-1">
                                        {item.text.replace(/^-\s*/, '')}
                                      </span>
                                    </li>
                                  ))}
                                </ul>

                                {/* MAP COMPONENT (Protected) */}
                                {content.timeline_data?.some(i => i.coords) && (
                                  <div className="mb-5 h-48 w-full rounded-xl overflow-hidden border border-slate-200 shadow-inner relative z-0">
                                    <MapContainer
                                      center={content.timeline_data.find(i => i.coords)?.coords || [35.6762, 139.6503]}
                                      zoom={11}
                                      scrollWheelZoom={false}
                                      className="h-full w-full"
                                    >
                                      <TileLayer
                                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                      />
                                      {content.timeline_data.map((item, i) => (
                                        item.coords && (
                                          <Marker key={i} position={item.coords}>
                                            <Popup>
                                              <span className="font-bold text-xs">{item.name}</span>
                                            </Popup>
                                          </Marker>
                                        )
                                      ))}
                                    </MapContainer>
                                  </div>
                                )}

                                <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => {
                                        const fullText = [
                                          content.title,
                                          content.report,
                                          (content.timeline_data || []).map(i => i.text).join('. ')
                                        ].filter(Boolean).join('. ');
                                        toggleAudio(fullText, msg.displayLang, idx);
                                      }}
                                      className={`flex items-center gap-1.5 text-xs font-bold transition-colors ${playingIndex === idx ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
                                    >
                                      {playingIndex === idx ? <StopCircle size={14} /> : <Volume2 size={14} />}
                                      {playingIndex === idx
                                        ? (msg.displayLang === 'English' ? 'Stop' : '停止')
                                        : (msg.displayLang === 'English' ? 'Listen' : '聞く')}
                                    </button>

                                    <button
                                      onClick={() => toggleCardLanguage(idx)}
                                      className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors ml-2"
                                    >
                                      <RefreshCw size={12} />
                                      {toggleLabel}
                                    </button>
                                  </div>

                                  {!msg.isWelcome && (
                                    <a
                                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(msg.data.city + ' ' + content.title)}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className={`inline-flex items-center gap-1.5 text-xs font-bold transition-colors hover:opacity-80 ${CATEGORY_THEMES[msg.data.category]?.text}`}
                                    >
                                      {msg.displayLang === 'English' ? 'Open Map' : '地図を開く'} <ExternalLink size={12} />
                                    </a>
                                  )}
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
              <div ref={messagesEndRef} />
            </main>

            {/* CONTROLLER */}
            <div className="absolute bottom-0 w-full bg-gradient-to-t from-white via-white/95 to-transparent pt-4 pb-6 px-4 z-30 flex flex-col items-center">

              {/* Verification Popup */}
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
                      <p className="text-base font-bold text-slate-900 leading-snug">"{targetLang === 'English' ? transcriptData.en : transcriptData.ja}"</p>
                      <p className="text-sm text-slate-400 italic mt-1">{targetLang === 'English' ? transcriptData.ja : transcriptData.en}</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={handleRetry} className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-bold text-slate-600">Retry</button>
                      <button onClick={handleConfirmVoice} className="flex-1 py-2 bg-slate-900 hover:bg-slate-800 rounded-lg text-xs font-bold text-white shadow-md">Generate</button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Input Controller */}
              <div className="absolute bottom-0 w-full bg-gradient-to-t from-white via-white/95 to-transparent pt-4 pb-6 px-4 z-30 flex flex-col items-center">

                {/* Verification Popup (Keep existing code) */}
                <AnimatePresence>
                  {appState === 'verification' && (
                    /* ... existing verification modal code ... */
                    <motion.div>...</motion.div>
                  )}
                </AnimatePresence>

                {/* Input Bar */}
                {appState !== 'verification' && (
                  <div className="w-full max-w-lg flex flex-col gap-3">
                    {/* Categories Row */}
                    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide mask-fade">
                      {CATEGORIES.map((cat) => (
                        <button
                          key={cat.id}
                          onClick={() => setCategory(cat.id)}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-full whitespace-nowrap text-xs font-bold transition-all border ${category === cat.id ? `${CATEGORY_THEMES[cat.id].active} text-white shadow-md` : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
                        >
                          {cat.icon}
                          {targetLang === 'English' ? cat.label : cat.ja}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-end gap-2 w-full">

                      {/* LEFT: CLEAR HISTORY TRIGGER */}
                      {chatHistory.length > 1 && (
                        <motion.button
                          key="trash-icon"
                          initial={{ scale: 0.8, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.8, opacity: 0 }}
                          onClick={() => setShowClearModal(true)}
                          className="w-12 h-[50px] bg-red-500 hover:bg-red-600 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-slate-200/500 transition-colors border border-red-400"
                          title="Clear History"
                        >
                          <Trash2 size={20} />
                        </motion.button>
                      )}

                      {/* RIGHT: TEXT INPUT BOX */}
                      <div className="flex-1 relative flex items-center gap-2 bg-white border border-slate-200 rounded-2xl p-2 shadow-lg shadow-slate-200/50">
                        <form onSubmit={handleTextSubmit} className="flex-1 flex items-center">
                          <input
                            type="text"
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            placeholder={appState === 'transcribing' ? (targetLang === 'English' ? "Processing Voice..." : "音声処理中...") : appState === 'planning' ? (targetLang === 'English' ? "Designing Plan..." : "プラン作成中...") : (targetLang === 'English' ? `Ask about ${CATEGORIES.find(c => c.id === category).label}...` : `${CATEGORIES.find(c => c.id === category).ja}について聞く...`)}
                            disabled={appState !== 'idle'}
                            className="w-full bg-transparent border-none outline-none focus:ring-0 focus:outline-none text-sm px-3 text-slate-800 placeholder:text-slate-400 h-8"
                          />
                        </form>

                        {inputText.trim().length > 0 ? (
                          <button onClick={handleTextSubmit} disabled={appState !== 'idle'} className="p-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-all shadow-md h-8 w-8 flex items-center justify-center">
                            <Send size={16} />
                          </button>
                        ) : (
                          (appState === 'transcribing' || appState === 'planning') ? (
                            <div className="p-2 rounded-xl bg-slate-100 text-slate-400 w-8 h-8 flex items-center justify-center">
                              <RefreshCw size={16} className="animate-spin" />
                            </div>
                          ) : (
                            <button
                              onClick={handleMicClick}
                              disabled={appState !== 'idle' && appState !== 'recording'}
                              className={`relative transition-all duration-200 shadow-md flex items-center justify-center overflow-hidden ${appState === 'recording' ? 'bg-red-500 w-16 rounded-xl' : 'bg-slate-900 w-8 rounded-xl hover:bg-slate-800'} ${(appState !== 'idle' && appState !== 'recording') ? 'opacity-50 cursor-not-allowed' : ''}`}
                              style={{ height: '32px' }}
                            >
                              {appState === 'recording' ? (
                                <div className="flex items-center justify-center gap-1 h-full w-full">
                                  {[0, 1, 2, 3, 4].map((i) => (
                                    <div key={i} ref={(el) => (visualizerBarsRef.current[i] = el)} className="w-1 bg-white/90 rounded-full transition-none will-change-[height]" style={{ height: '4px' }}></div>
                                  ))}
                                </div>
                              ) : (
                                <Mic size={16} className="text-white" />
                              )}
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* CONFIRMATION MODAL */}
      <AnimatePresence>
        {showClearModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/20 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 border border-slate-100"
            >
              <div className="flex flex-col items-center text-center gap-4">
                <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center text-red-500 mb-2">
                  <Trash2 size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Clear History?</h3>
                  <p className="text-sm text-slate-500 mt-1">
                    This action cannot be undone. All your chat data for this session will be permanently removed.
                  </p>
                </div>
                <div className="flex gap-3 w-full mt-2">
                  <button
                    onClick={() => setShowClearModal(false)}
                    className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-sm hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      handleClearHistory();
                      setShowClearModal(false);
                    }}
                    className="flex-1 py-2.5 rounded-xl bg-red-500 text-white font-bold text-sm hover:bg-red-600 shadow-md shadow-red-200 transition-colors"
                  >
                    Yes, Clear
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}