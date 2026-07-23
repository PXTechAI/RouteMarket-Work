import { useEffect, useState, type CSSProperties } from "react";

type AvatarScheme =
  | { kind: "emoji"; char: string; background: string | null }
  | { kind: "dicebear"; style: string; seed: string }
  | { kind: "url"; url: string }
  | { kind: "initials"; background: string | null };

function parseAvatarUrl(avatarUrl: string | null | undefined): AvatarScheme {
  if (!avatarUrl?.trim()) return { kind: "initials", background: null };
  const backgroundIndex = avatarUrl.indexOf("|bg:");
  const value = (backgroundIndex < 0 ? avatarUrl : avatarUrl.slice(0, backgroundIndex)).trim();
  const background =
    backgroundIndex < 0 ? null : avatarUrl.slice(backgroundIndex + 4).trim() || null;

  if (value.startsWith("emoji:")) {
    const char = value.slice(6).trim();
    return char
      ? { kind: "emoji", char, background }
      : { kind: "initials", background };
  }
  if (value.startsWith("dicebear:")) {
    const [style = "", ...seedParts] = value.slice(9).split(":");
    if (style.trim()) {
      return {
        kind: "dicebear",
        style: style.trim(),
        seed: seedParts.join(":").trim()
      };
    }
    return { kind: "initials", background };
  }
  if (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("/") ||
    value.startsWith("data:")
  ) {
    return { kind: "url", url: value };
  }
  if ((value.codePointAt(0) ?? 0) > 0x1f300) {
    return { kind: "emoji", char: value, background };
  }
  return { kind: "initials", background };
}

export function AgentAvatar({
  name,
  avatarUrl,
  size = 28,
  className = ""
}: {
  name: string;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const scheme = parseAvatarUrl(avatarUrl);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [avatarUrl]);

  const style: CSSProperties = {
    width: size,
    height: size,
    flex: `0 0 ${size}px`
  };
  const initials = name.trim().slice(0, 2).toUpperCase() || "A";

  if (!imageFailed && scheme.kind === "url") {
    return (
      <span className={`agent-avatar ${className}`} style={style}>
        <img src={scheme.url} alt="" onError={() => setImageFailed(true)} />
      </span>
    );
  }
  if (!imageFailed && scheme.kind === "dicebear") {
    const src = `https://api.dicebear.com/9.x/${encodeURIComponent(scheme.style)}/svg?seed=${encodeURIComponent(
      scheme.seed
    )}`;
    return (
      <span className={`agent-avatar ${className}`} style={style}>
        <img src={src} alt="" onError={() => setImageFailed(true)} />
      </span>
    );
  }
  if (scheme.kind === "emoji") {
    return (
      <span
        className={`agent-avatar emoji ${className}`}
        style={{
          ...style,
          background: scheme.background ?? undefined,
          fontSize: Math.max(11, Math.round(size * 0.54))
        }}
        aria-hidden="true"
      >
        {scheme.char}
      </span>
    );
  }
  return (
    <span
      className={`agent-avatar initials ${className}`}
      style={{
        ...style,
        background:
          scheme.kind === "initials" ? scheme.background ?? undefined : undefined,
        fontSize: Math.max(8, Math.round(size * 0.3))
      }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
