/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/renderer/**/*.{js,ts,jsx,tsx}",
    "./src/renderer/index.html"
  ],
  theme: {
    extend: {
      colors: {
        overlay: {
          bg: 'rgba(0, 0, 0, 0.85)',
          text: '#ffffff',
          accent: '#10B981',
        }
      },
      keyframes: {
        subtitleIn: {
          '0%':   { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0px)' },
        },
      },
      animation: {
        'subtitle-in': 'subtitleIn 0.2s ease-out forwards',
      },
    },
  },
  plugins: [],
}
