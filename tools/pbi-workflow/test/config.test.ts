import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  ConfigValidationError,
  parseWorkflowConfigYaml,
} from "../src/config.js";

async function fixture(name: string): Promise<string> {
  return readFile(new URL(`./fixtures/config/${name}.yaml`, import.meta.url), "utf8");
}

describe("parseWorkflowConfigYaml", () => {
  it("parses a valid config and applies documented defaults", async () => {
    const config = parseWorkflowConfigYaml(await fixture("valid"));

    expect(config.language).toBe("en");
    expect(config.orchestration).toEqual({
      maxParallelTasks: 3,
      leaseMinutes: 120,
      staleClaimPolicy: "requeue",
      maxReviewCycles: 3,
    });
    expect(config.labels.task.ready).toBe("ready-for-agent");
    expect(config.pullRequests.finalAutoMerge).toBe(false);
    expect(config.verification.format).toEqual({
      enabled: false,
      reason: "This repository has no standalone format check",
    });
  });

  it("reports every missing required section with a structured path", async () => {
    const source = await fixture("incomplete");
    expect(() => parseWorkflowConfigYaml(source)).toThrow(ConfigValidationError);

    try {
      parseWorkflowConfigYaml(source);
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      expect((error as ConfigValidationError).issues.map((issue) => issue.path)).toEqual(
        expect.arrayContaining(["$.trusted", "$.verification", "$.demo"]),
      );
    }
  });

  it("rejects unsupported versions, languages, and final auto-merge", async () => {
    try {
      parseWorkflowConfigYaml(await fixture("unsupported"));
      expect.unreachable("unsupported config should fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      expect((error as ConfigValidationError).issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "$.version" }),
          expect.objectContaining({ path: "$.language" }),
          expect.objectContaining({ path: "$.pullRequests.finalAutoMerge" }),
        ]),
      );
    }
  });

  it("rejects duplicate YAML keys", () => {
    expect(() => parseWorkflowConfigYaml("version: 1\nversion: 1\n")).toThrow(
      ConfigValidationError,
    );
  });

  it("requires a safe capture configuration for enabled demos", async () => {
    const source = (await fixture("valid")).replace(
      "  start:\n    enabled: false\n    reason: This package has no interactive application",
      "  start:\n    enabled: true\n    command: python -m app\n  url: http://127.0.0.1:5000",
    );
    expect(() => parseWorkflowConfigYaml(source)).toThrow(/capture/u);
    expect(() => parseWorkflowConfigYaml(`${source}\n  capture:\n    command: python -m app.demo\n    artifactsDirectory: ../outside\n`))
      .toThrow(/repository-relative/u);
  });
});