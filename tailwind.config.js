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
          DEFAULT: "#C8963E",
          light: "#DAB66A"
        }
      }
    }
  },
  plugins: []
};
