/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Space Grotesk", "sans-serif"],
      },
      colors: {
        ink: "#1d1d1f",
        sub: "#86868b",
        body: "#515154",
        line: "#d2d2d7",
        canvas: "#f5f5f7",
        accent: "#0071e3",
        ok: "#34c759",
        warn: "#ff9500",
      },
    },
  },
  plugins: [],
};
