// Renderer copy tests currently assert the Simplified Chinese resources.
// Pin the test locale so results do not depend on the Windows runner locale.
Object.defineProperty(globalThis.navigator, "language", {
  configurable: true,
  value: "zh-CN"
});
