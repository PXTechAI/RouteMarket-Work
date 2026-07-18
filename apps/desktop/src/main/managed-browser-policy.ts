export function normalizeBrowserUrl(value: string): string {
  const candidate = value.trim();
  if (!candidate) return "about:blank";
  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(candidate)
    ? candidate
    : `https://${candidate}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("Browser URL is invalid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:" && url.href !== "about:blank") {
    throw new Error("Managed Browser only allows HTTP and HTTPS navigation.");
  }
  if (url.username || url.password) {
    throw new Error("Browser URLs cannot contain embedded credentials.");
  }
  return url.href;
}

export function assertSafeSelector(selector: string): string {
  const value = selector.trim();
  if (!value || value.length > 2_048 || value.includes("\0")) {
    throw new Error("Browser selector is invalid.");
  }
  return value;
}

export function assertSafeBrowserText(text: string): string {
  if (text.length > 100_000 || text.includes("\0")) {
    throw new Error("Browser input text exceeds safety limits.");
  }
  return text;
}
