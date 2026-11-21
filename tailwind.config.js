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
                burgundy: {
                    DEFAULT: '#1d372c',
                    dark: '#12231c',
                    light: '#2b4a3c',
                },
                gold: {
                    DEFAULT: '#C9A35A',
                    light: '#E8D8B2',
                    cream: '#f6f1e6',
                },
                eggshell: '#F8F5F2',
                /** Sanctuary: evening grounds and gold-leaf light (see index.css). */
                wine: {
                    night: '#0e1512',
                    DEFAULT: '#0d1914',
                    deep: '#0b0f0d',
                },
                leaf: '#E4C36A',
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
                'gold-ink': '#7A5C0F',
            },
            fontFamily: {
                sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
                serif: ['Playfair Display', 'serif'],
                display: ['Playfair Display', 'serif'],
            },
            boxShadow: {
                card: '0 1px 2px rgba(26, 26, 26, 0.04), 0 4px 16px rgba(26, 26, 26, 0.05)',
                lift: '0 10px 30px rgba(0, 0, 0, 0.18)',
            },
        },
    },
    plugins: [],
}
