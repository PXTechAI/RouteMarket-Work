const SENSITIVE_KEY = /(?:authorization|cookie|credential|password|passwd|private[_-]?key|refresh[_-]?token|secret|session[_-]?token|access[_-]?token|api[_-]?key)/i;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const ASSIGNED_SECRET = /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|token|password|passwd|secret|cookie|credential)\s*[:=]\s*(["']?)[^\s,"'&]{4,}\2/gi;
const QUOTED_SECRET = /(["'])(authorization|cookie|credential|password|passwd|private[_-]?key|refresh[_-]?token|secret|session[_-]?token|access[_-]?token|api[_-]?key)\1\s*:\s*(["'])[^"'\r\n]{4,}\3/gi;
const URL_SECRET = /([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|token|password|secret)=)[^&\s#]+/gi;
const JWT_TOKEN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const QUOTED_WINDOWS_PATH = /(["'])(?:[A-Za-z]:\\|\\\\)[^"'\r\n]+\1/g;
const WINDOWS_PATH = /(?:\b[A-Za-z]:\\|\\\\)[^\s"'<>|]+/g;
const QUOTED_POSIX_PATH = /(["'])\/(?!\/)[^"'\r\n]+\1/g;
const POSIX_PATH = /(^|[\s(])\/(?!\/)[^\s"',)]+/g;
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
    .replace(
      QUOTED_SECRET,
      (_match, quote: string, name: string) =>
        `${quote}${name}${quote}:${quote}${REDACTED}${quote}`
    )
    .replace(URL_SECRET, `$1${REDACTED}`)
    .replace(JWT_TOKEN, REDACTED)
    .replace(QUOTED_WINDOWS_PATH, '"<local-path>"')
    .replace(WINDOWS_PATH, "<local-path>")
    .replace(QUOTED_POSIX_PATH, '"<local-path>"')
    .replace(POSIX_PATH, (_match, prefix: string) => `${prefix}<local-path>`);
}
