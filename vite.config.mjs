import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    // Increase chunk size warning limit
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          // Separate vendor chunks for better caching
          "react-vendor": ["react", "react-dom"],
          "zustand-vendor": ["zustand"],
          "uuid-vendor": ["uuid"],
          "lucide-react-vendor": ["lucide-react"],
          // Split markdown libraries into separate chunks
          "react-markdown": ["react-markdown"],
          "remark-gfm": ["remark-gfm"],
          // Note: remark-math and rehype-katex are no longer used
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  // Prevent vite from obscuring Rust errors
  clearScreen: false,
  // Tauri expects a fixed port, fail if that port is not available
  envPrefix: ["VITE_", "TAURI_"],
});
