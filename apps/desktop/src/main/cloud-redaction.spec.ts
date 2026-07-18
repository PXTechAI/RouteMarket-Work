import { describe, expect, it } from "vitest";
import { redactCloudData, redactCloudText } from "./cloud-redaction";

describe("cloud redaction", () => {
  it("redacts structured credential fields without changing ordinary outputs", () => {
    expect(redactCloudData({
      output: { text: "build complete", count: 2 },
      accessToken: "token-value",
      nested: { api_key: "key-value", safe: true }
    })).toEqual({
      output: { text: "build complete", count: 2 },
      accessToken: "[REDACTED]",
      nested: { api_key: "[REDACTED]", safe: true }
    });
  });

  it("redacts bearer tokens, assigned secrets and user-local absolute paths in logs", () => {
    const value = redactCloudText(
      "Authorization: Bearer abcdefghijklmnop token=my-secret-token C:\\Users\\alice\\project\\x.ts /home/alice/a.txt"
    );
    expect(value).not.toContain("abcdefghijklmnop");
    expect(value).not.toContain("my-secret-token");
    expect(value).not.toContain("alice");
    expect(value).toContain("[REDACTED]");
    expect(value).toContain("<local-path>");
  });
});
