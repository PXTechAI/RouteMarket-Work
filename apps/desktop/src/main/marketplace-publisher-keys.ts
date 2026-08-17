/**
 * Production Marketplace publisher keys are pinned in the signed desktop app.
 * Never populate this map from the catalog response or another runtime endpoint.
 */
declare const __ROUTEMARKET_MARKETPLACE_PUBLISHER_KEYS__: Readonly<Record<string, string>>;

export const MARKETPLACE_PUBLISHER_KEYS = Object.freeze({
  ...__ROUTEMARKET_MARKETPLACE_PUBLISHER_KEYS__
}) as Readonly<Record<string, string>>;
