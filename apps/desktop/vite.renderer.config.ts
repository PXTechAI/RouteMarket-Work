import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: resolve(__dirname, "src/renderer"),
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5175,
    strictPort: true
  }
});
