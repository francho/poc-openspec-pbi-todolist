import { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  CommandExecutionError,
  ExternalDataError,
  GitHubClient,
  OpenSpecClient,
  RepositoryScopeError,
  assertRepositoryScope,
  redactSecrets,
} from "../src/commands.js";
import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from "../src/commands.js";

class StubRunner implements CommandRunner {
  readonly requests: CommandRequest[] = [];

  constructor(private readonly result: CommandResult) {}

  run(request: CommandRequest): Promise<CommandResult> {
    this.requests.push(request);
    return Promise.resolve(this.result);
  }
}

describe("command adapters", () => {
  it("binds every GitHub issue read to the configured repository", async () => {
    const runner = new StubRunner({
      exitCode: 0,
      stdout: JSON.stringify({
        number: 42,
        title: "Checkout",
        url: "https://github.com/acme/shop/issues/42",
        state: "OPEN",
        body: "As a shopper...",
        author: { login: "product-owner" },
      }),
      stderr: "",
    });
    const client = new GitHubClient(runner, "/workspace", "Acme/Shop");

    await expect(client.getIssue(42)).resolves.toMatchObject({ number: 42 });
    expect(runner.requests).toEqual([
      {
        executable: "gh",
        cwd: "/workspace",
        args: [
          "issue",
          "view",
          "42",
          "--repo",
          "acme/shop",
          "--json",
          "number,title,url,state,body,author",
        ],
      },
    ]);
  });

  it("accepts the additional author metadata returned by gh", async () => {
    const runner = new StubRunner({
      exitCode: 0,
      stdout: JSON.stringify({
        number: 42,
        title: "Checkout",
        url: "https://github.com/acme/shop/issues/42",
        state: "OPEN",
        body: "As a shopper...",
        author: { login: "product-owner", id: "123", is_bot: false, name: "Product Owner" },
      }),
      stderr: "",
    });
    const client = new GitHubClient(runner, "/workspace", "acme/shop");

    await expect(client.getIssue(42)).resolves.toMatchObject({
      author: { login: "product-owner" },
    });
  });

  it.each([
    "Authentication failed for token=ghp_12345678901234567890",
    "HTTP 403 Bearer github_pat_12345678901234567890",
  ])("redacts credentials from command failures", async (stderr) => {
    const runner = new StubRunner({ exitCode: 1, stdout: "", stderr });
    const client = new GitHubClient(runner, "/workspace", "acme/shop");

    await expect(client.getIssue(42)).rejects.toThrow(CommandExecutionError);
    await expect(client.getIssue(42)).rejects.not.toThrow(/ghp_|github_pat_/u);
    expect(redactSecrets(stderr)).toContain("[REDACTED]");
  });

  it("rejects malformed external JSON", async () => {
    const runner = new StubRunner({ exitCode: 0, stdout: "not-json", stderr: "" });
    const client = new OpenSpecClient(runner, "/workspace");

    await expect(client.runJson(["list"], z.object({ changes: z.array(z.string()) }))).rejects.toThrow(
      ExternalDataError,
    );
  });

  it("rejects external JSON with the wrong shape", async () => {
    const runner = new StubRunner({
      exitCode: 0,
      stdout: JSON.stringify({ number: "42" }),
      stderr: "",
    });
    const client = new GitHubClient(runner, "/workspace", "acme/shop");

    await expect(client.getIssue(42)).rejects.toThrow(ExternalDataError);
  });

  it("rejects cross-repository operations", () => {
    expect(() => assertRepositoryScope("acme/shop", "acme/payments")).toThrow(
      RepositoryScopeError,
    );
    expect(() => assertRepositoryScope("Acme/Shop", "acme/shop")).not.toThrow();
  });
});