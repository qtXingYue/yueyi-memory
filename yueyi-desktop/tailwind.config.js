/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: {
          DEFAULT: "rgb(var(--c-base) / <alpha-value>)",
          panel: "rgb(var(--c-panel) / <alpha-value>)",
          panel2: "rgb(var(--c-panel2) / <alpha-value>)",
          border: "rgb(var(--c-border) / <alpha-value>)",
          borderSoft: "rgb(var(--c-border-soft) / <alpha-value>)",
        },
        ink: {
          DEFAULT: "rgb(var(--c-ink) / <alpha-value>)",
          dim: "rgb(var(--c-ink-dim) / <alpha-value>)",
          faint: "rgb(var(--c-ink-faint) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--c-accent) / <alpha-value>)",
          soft: "rgba(var(--c-accent-rgb), 0.12)",
          line: "rgba(var(--c-accent-rgb), 0.35)",
        },
        violet: {
          DEFAULT: "rgb(var(--c-violet) / <alpha-value>)",
          soft: "rgba(var(--c-violet-rgb), 0.12)",
        },
        rose: {
          DEFAULT: "rgb(var(--c-rose) / <alpha-value>)",
        },
        cyan: {
          DEFAULT: "rgb(var(--c-cyan) / <alpha-value>)",
        },
        moon: {
          DEFAULT: "rgb(var(--c-moon) / <alpha-value>)",
        },
        warn: {
          DEFAULT: "rgb(var(--c-warn) / <alpha-value>)",
        },
        danger: {
          DEFAULT: "rgb(var(--c-danger) / <alpha-value>)",
        },
        success: {
          DEFAULT: "rgb(var(--c-success) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "PingFang SC",
          "Microsoft YaHei UI",
          "Microsoft YaHei",
          "system-ui",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "Cascadia Code", "Consolas", "monospace"],
      },
      borderRadius: {
        xl2: "12px",
        xl3: "16px",
      },
      animation: {
        "fade-in": "fadeIn 0.22s ease-out",
        "fade-out": "fadeOut 0.2s ease-in forwards",
        "fade-slide": "fadeSlide 0.26s cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-left": "slideLeft 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
        "pulse-soft": "pulseSoft 2.6s ease-in-out infinite",
        "rise": "rise 0.34s cubic-bezier(0.16, 1, 0.3, 1)",
      },
      keyframes: {
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        fadeOut: { from: { opacity: "1" }, to: { opacity: "0" } },
        fadeSlide: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        slideLeft: {
          from: { opacity: "0", transform: "translateX(24px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
        rise: {
          from: { opacity: "0", transform: "translateY(10px) scale(0.99)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
      boxShadow: {
        card: "var(--shadow-card)",
        "card-hover": "var(--shadow-card-hover)",
        glow: "var(--shadow-glow)",
        drawer: "var(--shadow-drawer)",
      },
    },
  },
  plugins: [],
};
