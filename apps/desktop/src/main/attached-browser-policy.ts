export function normalizeDevToolsEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Attached Browser endpoint is invalid.");
  }
  const hostname = url.hostname.toLocaleLowerCase();
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "::1", "[::1]"].includes(hostname) ||
    url.username || url.password || url.search || url.hash
  ) {
    throw new Error("Attached Browser only accepts credential-free localhost HTTP endpoints.");
  }
  if (!url.port) throw new Error("Attached Browser endpoint requires an explicit DevTools port.");
  return `${url.protocol}//${url.host}`;
}

export function assertLocalDevToolsWebSocket(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DevTools target returned an invalid WebSocket URL.");
  }
  const hostname = url.hostname.toLocaleLowerCase();
  if (
    url.protocol !== "ws:" ||
    !["127.0.0.1", "localhost", "::1", "[::1]"].includes(hostname) ||
    url.username || url.password
  ) {
    throw new Error("DevTools target WebSocket must remain on localhost.");
  }
  return url.toString();
}
