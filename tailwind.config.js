/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        neon: {
          cyan: '#00ffff',
          magenta: '#ff00ff',
          green: '#00ff41',
          yellow: '#ffff00',
          orange: '#ff6600',
          red: '#ff0040',
        },
        surface: {
          900: '#0a0a0f',
          800: '#12121a',
          700: '#1a1a25',
          600: '#222230',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
    },
  },
  plugins: [],
}
