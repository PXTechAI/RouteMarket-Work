import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rendererRoot = fileURLToPath(new URL("../src/renderer/src/", import.meta.url));
const themePath = path.join(rendererRoot, "styles", "_theme.scss");
const tokensPath = path.join(rendererRoot, "styles", "tokens.scss");
const colorLiteralPattern = /#[0-9a-f]{3,8}\b|rgba?\(/gi;
const namedColorPattern =
  /(?:^|[;{]\s*)(?:color|background(?:-color)?|border(?:-[a-z-]+)?|fill|stroke)\s*:[^;{}]*\b(?:black|blue|green|orange|purple|red|white|yellow)\b/i;
const themeSelectorPattern = /\[data-theme\s*=|prefers-color-scheme/i;

const scssFiles = await collectScssFiles(rendererRoot);
const themeSource = await readFile(themePath, "utf8");
const staticTokens = extractMapKeys(themeSource, "static-tokens");
const lightTokens = extractMapKeys(themeSource, "light-theme");
const darkTokens = extractMapKeys(themeSource, "dark-theme");
const errors = [];

compareThemeMaps(lightTokens, darkTokens, errors);

const definedProperties = new Set([...staticTokens, ...lightTokens, ...darkTokens].map((token) => `rm-${token}`));
const referencedProperties = new Map();

for (const file of scssFiles) {
  const source = await readFile(file, "utf8");
  const relativePath = normalizePath(path.relative(rendererRoot, file));

  if (file !== themePath) {
    collectMatches(source, colorLiteralPattern, (match) => {
      errors.push(
        `${relativePath}:${lineNumberAt(source, match.index)} direct color literal ${JSON.stringify(match[0])}`,
      );
    });
    for (const [index, line] of source.split(/\r?\n/).entries()) {
      const withoutCustomProperties = line.replace(/var\(--[^)]+\)/g, "");
      if (namedColorPattern.test(withoutCustomProperties)) {
        errors.push(`${relativePath}:${index + 1} named color must come from a theme token`);
      }
    }
  }

  if (file !== tokensPath && themeSelectorPattern.test(source)) {
    errors.push(`${relativePath} Light/Dark selectors are only allowed in styles/tokens.scss`);
  }

  collectMatches(source, /--([a-z][a-z0-9-]*)\s*:/gi, (match) => definedProperties.add(match[1]));
  collectMatches(source, /var\(--([a-z][a-z0-9-]*)/gi, (match) => {
    const name = match[1];
    if (!name.startsWith("rm-")) return;
    const references = referencedProperties.get(name) ?? [];
    references.push(`${relativePath}:${lineNumberAt(source, match.index)}`);
    referencedProperties.set(name, references);
  });
}

for (const [name, references] of referencedProperties) {
  if (!definedProperties.has(name)) {
    errors.push(`${references[0]} references undefined custom property --${name}`);
  }
}

if (errors.length) {
  console.error("Style token validation failed:\n" + errors.map((error) => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Style token validation passed (${scssFiles.length} SCSS files, ${lightTokens.size} theme tokens).`);
}

async function collectScssFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectScssFiles(entryPath)));
    else if (entry.isFile() && entry.name.endsWith(".scss")) files.push(entryPath);
  }
  return files.sort();
}

function extractMapKeys(source, mapName) {
  const match = source.match(new RegExp(`\\$${mapName}:\\s*\\(([\\s\\S]*?)\\n\\);`));
  if (!match) throw new Error(`Unable to find SCSS map $${mapName}`);
  const keys = new Set();
  for (const keyMatch of match[1].matchAll(/^\s{2}([a-z][a-z0-9-]+):/gm)) {
    if (keys.has(keyMatch[1])) throw new Error(`Duplicate token ${keyMatch[1]} in $${mapName}`);
    keys.add(keyMatch[1]);
  }
  return keys;
}

function compareThemeMaps(lightTokens, darkTokens, validationErrors) {
  for (const token of lightTokens) {
    if (!darkTokens.has(token)) validationErrors.push(`Dark theme is missing token ${token}`);
  }
  for (const token of darkTokens) {
    if (!lightTokens.has(token)) validationErrors.push(`Light theme is missing token ${token}`);
  }
}

function collectMatches(source, pattern, visitor) {
  pattern.lastIndex = 0;
  for (const match of source.matchAll(pattern)) visitor(match);
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function normalizePath(value) {
  return value.split(path.sep).join("/");
}
