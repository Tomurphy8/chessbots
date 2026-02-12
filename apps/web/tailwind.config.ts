import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        chess: {
          dark: '#0a0a0f',
          surface: '#12121a',
          border: '#1e1e2e',
          accent: '#7c3aed',
          'accent-light': '#a78bfa',
          gold: '#fbbf24',
          silver: '#94a3b8',
          bronze: '#d97706',
        },
      },
    },
  },
  plugins: [],
};

export default config;
