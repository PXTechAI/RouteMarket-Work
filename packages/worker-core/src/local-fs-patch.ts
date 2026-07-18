import { WorkerError } from "./errors";
import { writeLocalProjectFile, type LocalFsWriteResult } from "./local-fs-write";
import { ProjectRegistry } from "./project-registry";

export type TextPatchOperation = {
  oldText: string;
  newText: string;
  replaceAll?: boolean;
};

export type LocalFsPatchResult = LocalFsWriteResult & {
  replacementsApplied: number;
};

export async function applyLocalProjectPatch(
  registry: ProjectRegistry,
  input: {
    localProjectId: string;
    relativePath: string;
    originalText: string;
    expectedSha256: string;
    operations: TextPatchOperation[];
  }
): Promise<LocalFsPatchResult> {
  if (input.operations.length < 1 || input.operations.length > 100) {
    throw new WorkerError("TOOL_INPUT_INVALID", "A Patch requires 1 to 100 operations.");
  }

  let text = input.originalText;
  let replacementsApplied = 0;
  for (const operation of input.operations) {
    if (!operation.oldText) {
      throw new WorkerError("TOOL_INPUT_INVALID", "Patch search text cannot be empty.");
    }
    const occurrences = countOccurrences(text, operation.oldText);
    if (occurrences === 0) {
      throw new WorkerError("PATCH_CONTEXT_NOT_FOUND", "Patch context was not found in the file.");
    }
    if (!operation.replaceAll && occurrences !== 1) {
      throw new WorkerError(
        "PATCH_CONTEXT_AMBIGUOUS",
        "Patch context occurs more than once; provide more context or explicitly replace all."
      );
    }
    if (operation.replaceAll) {
      text = text.replaceAll(operation.oldText, operation.newText);
      replacementsApplied += occurrences;
    } else {
      text = text.replace(operation.oldText, operation.newText);
      replacementsApplied += 1;
    }
  }

  const result = await writeLocalProjectFile(registry, {
    localProjectId: input.localProjectId,
    relativePath: input.relativePath,
    text,
    expectedSha256: input.expectedSha256
  });
  return { ...result, replacementsApplied };
}

function countOccurrences(value: string, search: string): number {
  let count = 0;
  let offset = 0;
  while (offset <= value.length - search.length) {
    const index = value.indexOf(search, offset);
    if (index < 0) break;
    count += 1;
    offset = index + search.length;
  }
  return count;
}
