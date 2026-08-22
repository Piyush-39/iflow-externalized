import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: process.env.VERCEL === "1" ? "../public" : "dist",
    emptyOutDir: process.env.VERCEL !== "1"
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001"
    }
  }
});
