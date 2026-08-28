import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0a0a0b",
        surface: "#141417",
        line: "#26262b",
        body: "#e5e5e7",
        muted: "#8a8a94",
        pass: "#10b981",
        fail: "#ef4444",
        review: "#f59e0b",
      },
    },
  },
  plugins: [],
} satisfies Config;
