/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'japan-indigo': '#2D3748', // Deep blue for text
        'japan-blue': '#A0D8EF',   // Sky blue
        'japan-sakura': '#FCE9F1', // Very pale pink for backgrounds
        'japan-red': '#E94B3C',    // Accent (Torii gate red)
        'glass-white': 'rgba(255, 255, 255, 0.7)',
      },
      fontFamily: {
        sans: ['"Noto Sans JP"', 'sans-serif'], // Standard Japanese web font
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    },
  },
  plugins: [],
}