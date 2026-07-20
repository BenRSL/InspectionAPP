import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // RSLQLD brand — RESOLVED in Project Bible v1.6, Section 9
        rsl: {
          red: '#C01820',      // primary — fails, alerts, CTA
          navy: '#1A1A2E',     // primary dark — headers, nav
          blue: '#1A3A6B',     // secondary — links, State of Health theme
          gold: '#E8A020',     // accent — recurring flags, in-progress states
        },
        pass: '#2F8F4E',
        fail: '#C01820',
        // SOHC condition rating scale — good reuses `pass`, critical reuses `fail`/`rsl.red`
        condition: {
          good: '#2F8F4E',
          fair: '#E8A020',
          poor: '#E8720A',
          critical: '#C01820',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'sans-serif'],
        body: ['var(--font-body)', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;
