/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Space Grotesk", "PingFang SC", "Microsoft YaHei", "sans-serif"],
        mono: ["JetBrains Mono", "SFMono-Regular", "Menlo", "monospace"]
      },
      colors: {
        kinetic: {
          floor: "#0e0e0e",
          surface: "#131313",
          plate: "#201f1f",
          raised: "#353534",
          accent: "#4be277",
          accentStrong: "#22c55e"
        }
      }
    }
  },
  plugins: []
};
