import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        sidebar: 'var(--sidebar)',
        'sidebar-active': 'var(--sidebar-active)',
        'sidebar-border': 'var(--sidebar-border)',
        'sidebar-text': 'var(--sidebar-text)',
        'sidebar-text-active': 'var(--sidebar-text-active)',
        'logo-accent': 'var(--logo-accent)',
        surface: 'var(--surface)',
        surface2: 'var(--surface2)',
        border: 'var(--border)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted': 'var(--text-muted)',
        accent: 'var(--accent)',
        'accent-bg': 'var(--accent-bg)',
        green: 'var(--green)',
        'green-bg': 'var(--green-bg)',
        amber: 'var(--amber)',
        'amber-bg': 'var(--amber-bg)',
        red: 'var(--red)',
        'red-bg': 'var(--red-bg)',
        purple: 'var(--purple)',
        'purple-bg': 'var(--purple-bg)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
