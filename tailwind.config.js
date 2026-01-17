/** @type {import('tailwindcss').Config} */
export default {
    content: [
      "./src/renderer/**/*.{js,ts,jsx,tsx}",
      "./src/renderer/index.html",
    ],
    darkMode: 'media', // or 'class'
    theme: {
      extend: {
        colors: {
            background: "#1a1a1a",
            surface: "#262626",
            border: "#404040",
            primary: "#3b82f6", // blue-500
        },
        fontFamily: {
            sans: [
                "ui-sans-serif",
                "system-ui",
                "-apple-system",
                "BlinkMacSystemFont",
                "PingFang SC", // Fix for CoreText warning on macOS Chinese
                "Segoe UI",
                "Roboto",
                "Helvetica Neue",
                "Arial",
                "sans-serif",
            ],
        }
      },
    },
    plugins: [],
  }
