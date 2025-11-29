/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                'kaze-dark': '#0f172a',    // Slate 900
                'kaze-card': '#1e293b',    // Slate 800
                'kaze-accent': '#38bdf8',  // Sky 400
                'kaze-text': '#f1f5f9',    // Slate 100
                'kaze-muted': '#94a3b8',   // Slate 400
            },
            fontFamily: {
                sans: ['"Noto Sans JP"', 'sans-serif'],
            },
            animation: {
                'float': 'float 6s ease-in-out infinite',
                'glow': 'glow 2s ease-in-out infinite alternate',
            },
            keyframes: {
                float: {
                    '0%, 100%': { transform: 'translateY(0)' },
                    '50%': { transform: 'translateY(-10px)' },
                },
                glow: {
                    'from': { boxShadow: '0 0 10px #38bdf8', borderColor: '#38bdf8' },
                    'to': { boxShadow: '0 0 20px #38bdf8', borderColor: '#7dd3fc' },
                }
            }
        },
    },
    plugins: [],
}