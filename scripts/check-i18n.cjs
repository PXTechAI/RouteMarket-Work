const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const messagesRoot = path.join(root, "apps/desktop/src/renderer/src/i18n/messages");
const en = readMessages(path.join(messagesRoot, "generated.en-US.ts"));
const zh = readMessages(path.join(messagesRoot, "generated.zh-CN.ts"));
const allKeys = new Set([...en.keys(), ...zh.keys()]);
let failed = false;

for (const key of [...allKeys].sort()) {
  if (!en.has(key) || !zh.has(key)) {
    failed = true;
    process.stdout.write(`${key}: missing from ${en.has(key) ? "zh-CN" : "en-US"}\n`);
    continue;
  }
  const enParams = placeholders(en.get(key));
  const zhParams = placeholders(zh.get(key));
  if (JSON.stringify(enParams) !== JSON.stringify(zhParams)) {
    failed = true;
    process.stdout.write(`${key}: en=${JSON.stringify(enParams)} zh=${JSON.stringify(zhParams)}\n`);
    process.stdout.write(`  en: ${en.get(key)}\n  zh: ${zh.get(key)}\n`);
  }
}

process.stdout.write(`${allKeys.size} generated messages checked.\n`);
process.exitCode = failed ? 1 : 0;

function readMessages(file) {
  const content = fs.readFileSync(file, "utf8");
  return new Map([...content.matchAll(/^\s*("ui\.[a-f0-9]+"):\s*("(?:\\.|[^"\\])*")[, ]*$/gm)]
    .map((match) => [JSON.parse(match[1]), JSON.parse(match[2])]));
}

function placeholders(value) {
  return [...value.matchAll(/\{\d+\}/g)].map(([placeholder]) => placeholder).sort();
}
