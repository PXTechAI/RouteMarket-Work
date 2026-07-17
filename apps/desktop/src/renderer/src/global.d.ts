import type { RouteMarketWorkApi } from "../../shared/desktop-api";

declare global {
  interface Window {
    routeMarketWork?: RouteMarketWorkApi;
  }
}

export {};
