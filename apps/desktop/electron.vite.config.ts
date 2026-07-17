import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const defaultApiBaseUrl =
    mode === "production"
      ? "https://console.routemarket.ai"
      : "http://localhost:3000";

  return {
    main: {
      define: {
        __ROUTEMARKET_WORK_DEFAULT_API_URL__: JSON.stringify(defaultApiBaseUrl)
      },
      build: {
        rollupOptions: {
          input: {
            index: resolve(__dirname, "src/main/index.ts"),
            worker: resolve(__dirname, "src/worker/index.ts")
          }
        }
      }
    },
    preload: {
      build: {
        rollupOptions: {
          input: resolve(__dirname, "src/preload/index.ts"),
          output: {
            format: "cjs",
            entryFileNames: "index.cjs"
          }
        }
      }
    },
    renderer: {
      root: resolve(__dirname, "src/renderer"),
      plugins: [react()]
    }
  };
});
