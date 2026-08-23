import { describe, expect, it } from "vitest";
import { SingleFlightByKey } from "./single-flight";

describe("SingleFlightByKey", () => {
  it("shares concurrent work for the same key and permits later work", async () => {
    const gate = new SingleFlightByKey<string>();
    let calls = 0;
    let release: ((value: string) => void) | undefined;
    const task = () => {
      calls += 1;
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    };

    const first = gate.run("project_1", task);
    const second = gate.run("project_1", task);
    await Promise.resolve();
    expect(calls).toBe(1);
    release?.("page_1");
    await expect(Promise.all([first, second])).resolves.toEqual(["page_1", "page_1"]);

    await expect(gate.run("project_1", async () => "page_2")).resolves.toBe("page_2");
  });

  it("clears failed work so it can be retried", async () => {
    const gate = new SingleFlightByKey<string>();
    await expect(gate.run("project_1", async () => {
      throw new Error("initialization failed");
    })).rejects.toThrow("initialization failed");
    await expect(gate.run("project_1", async () => "recovered")).resolves.toBe("recovered");
  });
});
