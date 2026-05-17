import baseConfig from '@extension/tailwindcss-config';
import type { Config } from 'tailwindcss/types/config';

export default {
  ...baseConfig,
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      keyframes: {
        progress: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        qaInputGlow: {
          '0%, 100%': {
            boxShadow: '0 0 10px rgba(25, 194, 255, 0.45), 0 0 22px rgba(0, 115, 220, 0.25)',
          },
          '50%': {
            boxShadow: '0 0 16px rgba(25, 194, 255, 0.8), 0 0 32px rgba(99, 102, 241, 0.45)',
          },
        },
        qaGlowSpin: {
          from: { transform: 'translate(-50%, -50%) rotate(0deg)' },
          to: { transform: 'translate(-50%, -50%) rotate(360deg)' },
        },
      },
      animation: {
        progress: 'progress 1.5s infinite ease-in-out',
        'qa-input-glow': 'qaInputGlow 2.4s ease-in-out infinite',
        'qa-glow-spin': 'qaGlowSpin 2.4s linear infinite',
      },
    },
  },
} as Config;
