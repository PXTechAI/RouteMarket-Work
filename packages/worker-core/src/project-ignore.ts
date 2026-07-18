export function createProjectIgnoreMatcher(patterns: string[]): (relativePath: string) => boolean {
  const compiled = patterns
    .map((pattern) => pattern.trim().replaceAll("\\", "/"))
    .filter((pattern) => pattern && !pattern.startsWith("!"))
    .map(compilePattern);
  return (relativePath) => {
    const normalized = relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
    return compiled.some((pattern) => pattern.test(normalized));
  };
}

function compilePattern(value: string): RegExp {
  const anchored = value.startsWith("/");
  const directory = value.endsWith("/") || value.endsWith("/**");
  const pattern = value.replace(/\/\*\*$/, "").replace(/^\/+|\/+$/g, "");
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === "*" && pattern[index + 1] === "*") {
      source += ".*";
      index += 1;
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  const prefix = anchored || pattern.includes("/") ? "^" : "(?:^|/)";
  const suffix = directory ? "(?:/.*)?$" : "(?:$|/.*$)";
  return new RegExp(`${prefix}${source}${suffix}`, "i");
}
