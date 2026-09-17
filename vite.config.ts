import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  optimizeDeps: {
    include: ["pdf-lib", "@pdf-lib/fontkit", "tesseract.js", "fflate", "zod"],
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: [
        "**/.tools/**",
        "**/src-tauri/**",
        "**/tests/native/target/**",
        "**/LICENSES/**",
      ],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "es2022" },
  worker: { format: "es" },
});
