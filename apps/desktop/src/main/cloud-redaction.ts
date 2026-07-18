const SENSITIVE_KEY = /(?:authorization|cookie|credential|password|passwd|private[_-]?key|refresh[_-]?token|secret|session[_-]?token|access[_-]?token|api[_-]?key)/i;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const ASSIGNED_SECRET = /\b(api[_-]?key|token|password|secret)\s*[:=]\s*(["']?)[^\s,"']{6,}\2/gi;
const WINDOWS_USER_PATH = /\b[A-Za-z]:\\Users\\[^\\\s"']+(?:\\[^\s"']*)?/gi;
const POSIX_USER_PATH = /\/(?:Users|home)\/[^/\s"']+(?:\/[^\s"']*)?/g;
const REDACTED = "[REDACTED]";

export function redactCloudData(value: unknown, depth = 0): unknown {
  if (depth > 20) return "[TRUNCATED]";
  if (typeof value === "string") return redactCloudText(value);
  if (Array.isArray(value)) return value.slice(0, 10_000).map((item) => redactCloudData(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 10_000)) {
    output[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactCloudData(item, depth + 1);
  }
  return output;
}

export function redactCloudText(value: string): string {
  return value
    .replace(BEARER_TOKEN, `Bearer ${REDACTED}`)
    .replace(ASSIGNED_SECRET, (_match, name: string) => `${name}=${REDACTED}`)
    .replace(WINDOWS_USER_PATH, "<local-path>")
    .replace(POSIX_USER_PATH, "<local-path>");
}
