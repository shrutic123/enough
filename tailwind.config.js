/** Tailwind v3 config for Enough. Colors point at the CSS variables in enough.css,
 *  so light/dark switching happens in one place (the media query there).
 *
 *  Tailwind v4 instead: delete this file and add to your CSS
 *    @theme {
 *      --color-fog: var(--fog);  --color-paper: var(--paper);  --color-ink: var(--ink);
 *      --color-graphite: var(--graphite);  --color-line: var(--line);  --color-pencil: var(--pencil);
 *      --font-sans: "Instrument Sans", system-ui, sans-serif;
 *      --font-serif: "Instrument Serif", serif;
 *    }
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        fog: 'var(--fog)',
        paper: 'var(--paper)',
        ink: 'var(--ink)',
        graphite: 'var(--graphite)',
        line: 'var(--line)',
        pencil: 'var(--pencil)',
      },
      fontFamily: {
        sans: ['"Instrument Sans"', 'system-ui', 'sans-serif'],
        serif: ['"Instrument Serif"', 'serif'],
      },
      borderRadius: { card: '14px' },
    },
  },
  plugins: [],
};
