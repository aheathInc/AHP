import type { Config } from 'tailwindcss';

/*
 * Colour carries clinical meaning and nothing else.
 *
 * On a triage queue that stops being a style preference and starts doing
 * work: clay marks an emergency, amber marks urgent, and a routine case gets
 * no accent at all. A clinician scanning twenty rows finds the one that
 * cannot wait without reading a word. Decorating every row would destroy
 * exactly the signal this exists for — which is why there is no "brand
 * colour" applied for its own sake anywhere in this app.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#172B3F',
        'ink-soft': '#526577',
        paper: '#F5F7FA',
        'paper-sunk': '#EDF2F6',
        line: '#D9E2EA',
        navy: '#071A2F',
        'navy-lift': '#0E2844',
        petrol: '#123B64',
        'petrol-lift': '#1B517E',
        teal: '#12A99A',
        blue: '#245F96',
        amber: '#C2700B',
        clay: '#A63D2F',
      },
      fontFamily: {
        sans: ['var(--font-open-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-plex-mono)', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
