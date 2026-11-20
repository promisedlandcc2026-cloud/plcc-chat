/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./App.tsx",
        "./components/**/*.{js,ts,jsx,tsx}",
        "./context/**/*.{js,ts,jsx,tsx}",
        "./pages/**/*.{js,ts,jsx,tsx}",
        "./lib/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            screens: {
                xs: '320px',
            },
            colors: {
                /** Red Earth & Gold: raised warm-charcoal surface (buttons turn gold in index.css). */
                burgundy: {
                    DEFAULT: '#2B211B',
                    dark: '#1A1410',
                    light: '#3A2E27',
                },
                gold: {
                    DEFAULT: '#F4B23E',
                    light: '#E8D8B2',
                    cream: '#f6f1e6',
                },
                eggshell: '#F8F5F2',
                /** Sanctuary: evening grounds and gold-leaf light (see index.css). */
                wine: {
                    night: '#211915',
                    DEFAULT: '#2B211B',
                    deep: '#15100D',
                },
                leaf: '#F4B23E',
                cream: '#F8F5F2',
                /** gray-500 darkened so secondary text passes WCAG AA on white and eggshell. */
                gray: {
                    500: '#636A77',
                },
                /** Body text */
                ink: {
                    DEFAULT: '#1A1A1A',
                    muted: '#4B5563',
                    soft: '#636A77',
                },
                /** Gold that passes contrast as text on white/eggshell (brand gold is for fills). */
                'gold-ink': '#F4B23E',
            },
            fontFamily: {
                sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
                serif: ['Bricolage Grotesque', 'Plus Jakarta Sans', 'sans-serif'],
                display: ['Bricolage Grotesque', 'Plus Jakarta Sans', 'sans-serif'],
            },
            boxShadow: {
                card: '0 1px 2px rgba(26, 26, 26, 0.04), 0 4px 16px rgba(26, 26, 26, 0.05)',
                lift: '0 10px 30px rgba(0, 0, 0, 0.18)',
            },
        },
    },
    plugins: [],
}
