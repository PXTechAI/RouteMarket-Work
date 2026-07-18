export type DiffLine = {
  kind: "context" | "added" | "removed" | "separator";
  text: string;
  beforeLine: number | null;
  afterLine: number | null;
};

export function createDiffPreview(before: string, after: string): DiffLine[] {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) suffix += 1;

  const output: DiffLine[] = [];
  const contextStart = Math.max(0, prefix - 3);
  if (contextStart > 0) output.push(separator());
  for (let index = contextStart; index < prefix; index += 1) {
    output.push({ kind: "context", text: oldLines[index]!, beforeLine: index + 1, afterLine: index + 1 });
  }
  for (let index = prefix; index < oldLines.length - suffix; index += 1) {
    output.push({ kind: "removed", text: oldLines[index]!, beforeLine: index + 1, afterLine: null });
  }
  for (let index = prefix; index < newLines.length - suffix; index += 1) {
    output.push({ kind: "added", text: newLines[index]!, beforeLine: null, afterLine: index + 1 });
  }
  const suffixToShow = Math.min(3, suffix);
  for (let offset = suffix - suffixToShow; offset < suffix; offset += 1) {
    const oldIndex = oldLines.length - suffix + offset;
    const newIndex = newLines.length - suffix + offset;
    output.push({
      kind: "context",
      text: oldLines[oldIndex]!,
      beforeLine: oldIndex + 1,
      afterLine: newIndex + 1
    });
  }
  if (suffix > suffixToShow) output.push(separator());
  return output;
}

function separator(): DiffLine {
  return { kind: "separator", text: "…", beforeLine: null, afterLine: null };
}
