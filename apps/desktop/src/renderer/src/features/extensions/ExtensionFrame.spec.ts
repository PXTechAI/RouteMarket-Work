import { describe, expect, it } from "vitest";
import { parseFilePickMessage } from "./ExtensionFrame";

describe("desktop extension host protocol", () => {
  it("accepts a bounded file picker request", () => {
    expect(parseFilePickMessage({
      protocol: "routemarket-extension/1",
      type: "host.files.pick",
      requestId: "request_1",
      request: {
        purpose: "media-input",
        title: "Pick avatar",
        extensions: ["mp4", "png"]
      }
    })).toEqual({
      requestId: "request_1",
      request: {
        purpose: "media-input",
        title: "Pick avatar",
        extensions: ["mp4", "png"]
      }
    });
  });

  it("accepts user-selected data files without granting media access", () => {
    expect(parseFilePickMessage({
      protocol: "routemarket-extension/1",
      type: "host.files.pick",
      requestId: "request_csv",
      request: {
        purpose: "data-input",
        title: "Pick batch data",
        extensions: ["csv"]
      }
    })).toEqual({
      requestId: "request_csv",
      request: {
        purpose: "data-input",
        title: "Pick batch data",
        extensions: ["csv"]
      }
    });
  });

  it("rejects unknown messages and capabilities", () => {
    expect(parseFilePickMessage({
      protocol: "routemarket-extension/1",
      type: "host.files.pick",
      requestId: "request_2",
      request: { purpose: "filesystem-root" }
    })).toBeNull();
    expect(parseFilePickMessage({ protocol: "other", type: "host.files.pick" })).toBeNull();
  });
});
