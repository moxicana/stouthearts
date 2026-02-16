/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{vue,js,ts}"],
  theme: {
    extend: {
      fontFamily: {
        heading: ["Cinzel", "ui-serif", "Georgia", "Cambria", "\"Times New Roman\"", "serif"]
      },
      colors: {
        brand: {
          DEFAULT: "#215a4b",
          light: "#7bb29d"
        }
      }
    }
  },
  plugins: []
};
