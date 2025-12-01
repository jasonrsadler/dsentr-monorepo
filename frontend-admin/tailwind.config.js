/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: '#0f172a',
        stone: '#1f2937',
        accent: '#0ea5e9',
        muted: '#6b7280',
      },
    },
  },
  plugins: [],
};
