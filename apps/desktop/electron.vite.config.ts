import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import {
  resolveBuildEndpoints,
  resolveBuildUpdateFeed
} from "./build-endpoints";

export default defineConfig(({ mode }) => {
  const endpoints = resolveBuildEndpoints(mode);
  const updateFeed = resolveBuildUpdateFeed(mode);

  return {
    main: {
      define: {
        __ROUTEMARKET_WORK_BUILD_ENVIRONMENT__: JSON.stringify(
          endpoints.buildEnvironment
        ),
        __ROUTEMARKET_WORK_DEFAULT_UPDATE_URL__: JSON.stringify(updateFeed),
        __ROUTEMARKET_WORK_DEFAULT_API_URL__: JSON.stringify(endpoints.apiBaseUrl),
        __ROUTEMARKET_WORK_DEFAULT_WEB_URL__: JSON.stringify(endpoints.webBaseUrl)
      },
      build: {
        rollupOptions: {
          external: ["ws"],
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
