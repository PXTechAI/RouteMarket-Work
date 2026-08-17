import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import {
  resolveBuildAnalytics,
  resolveBuildEndpoints,
  resolveBuildMarketplacePublisherKeys,
  resolveBuildUpdateFeed
} from "./build-endpoints";

export default defineConfig(({ mode }) => {
  const environment = {
    ...loadEnv(mode, resolve(__dirname, "../.."), ""),
    ...process.env
  };
  const endpoints = resolveBuildEndpoints(mode, environment);
  const updateFeed = resolveBuildUpdateFeed(mode, environment);
  const marketplacePublisherKeys = resolveBuildMarketplacePublisherKeys(mode, environment);
  const analytics = resolveBuildAnalytics(mode, environment);

  return {
    main: {
      define: {
        __ROUTEMARKET_WORK_BUILD_ENVIRONMENT__: JSON.stringify(
          endpoints.buildEnvironment
        ),
        __ROUTEMARKET_WORK_BUILD_ID__: JSON.stringify(
          environment.ROUTEMARKET_WORK_BUILD_ID?.trim()
          || environment.GITHUB_SHA?.trim()
          || null
        ),
        __ROUTEMARKET_WORK_DEFAULT_UPDATE_URL__: JSON.stringify(updateFeed),
        __ROUTEMARKET_WORK_DEFAULT_API_URL__: JSON.stringify(endpoints.apiBaseUrl),
        __ROUTEMARKET_WORK_DEFAULT_WEB_URL__: JSON.stringify(endpoints.webBaseUrl),
        __ROUTEMARKET_MARKETPLACE_PUBLISHER_KEYS__: JSON.stringify(marketplacePublisherKeys),
        __ROUTEMARKET_WORK_ANALYTICS_CONFIG__: JSON.stringify(analytics)
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
