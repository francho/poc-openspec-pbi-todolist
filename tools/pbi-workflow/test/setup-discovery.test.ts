import { describe, expect, it } from "vitest";

import {
  GitHubSetupProbe,
  buildSetupPreview,
  discoverSetup,
} from "../src/setup-discovery.js";
import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from "../src/commands.js";
import type { SetupProbe } from "../src/setup-discovery.js";

class ReadOnlyProbe implements SetupProbe {
  readonly calls: string[] = [];

  getRepository() {
    this.calls.push("getRepository");
    return Promise.resolve({ nameWithOwner: "Acme/Shop", defaultBranch: "main" });
  }

  getCurrentActor() {
    this.calls.push("getCurrentActor");
    return Promise.resolve("maintainer");
  }

  getLabels() {
    this.calls.push("getLabels");
    return Promise.resolve(["pbi/refinement", "bug"]);
  }

  getRequiredChecks(repository: string, branch: string) {
    this.calls.push(`getRequiredChecks:${repository}:${branch}`);
    return Promise.resolve(["ci", "security"]);
  }

  getPackageScripts() {
    this.calls.push("getPackageScripts");
    return Promise.resolve({
      "format:check": "prettier --check .",
      lint: "eslint .",
      typecheck: "tsc --noEmit",
      test: "vitest run",
      build: "tsc",
      dev: "vite",
    });
  }

  hasFile(path: string) {
    this.calls.push(`hasFile:${path}`);
    return Promise.resolve(true);
  }
}

class RecordingRunner implements CommandRunner {
  readonly requests: CommandRequest[] = [];

  run(request: CommandRequest): Promise<CommandResult> {
    this.requests.push(request);
    const invocation = request.args.join(" ");
    const responses: Record<string, string> = {
      "repo view --json nameWithOwner,defaultBranchRef": JSON.stringify({
        nameWithOwner: "Acme/Shop",
        defaultBranchRef: { name: "main" },
      }),
      "api user": JSON.stringify({ login: "maintainer" }),
      "label list --limit 1000 --json name": JSON.stringify([
        { name: "pbi/refinement" },
      ]),
      "api repos/Acme/Shop/branches/main/protection/required_status_checks":
        JSON.stringify({ contexts: ["ci"] }),
    };
    return Promise.resolve({
      exitCode: responses[invocation] === undefined ? 1 : 0,
      stdout: responses[invocation] ?? "",
      stderr: responses[invocation] === undefined ? "unexpected invocation" : "",
    });
  }
}

describe("setup discovery", () => {
  it("collects repository facts through read-only probes", async () => {
    const probe = new ReadOnlyProbe();
    const discovery = await discoverSetup(probe);

    expect(discovery).toMatchObject({
      repository: "acme/shop",
      defaultBranch: "main",
      currentActor: "maintainer",
      requiredChecks: ["ci", "security"],
      commands: {
        install: "npm ci",
        format: "npm run format:check",
        lint: "npm run lint",
        typecheck: "npm run typecheck",
        test: "npm run test",
        build: "npm run build",
        demoStart: "npm run dev",
      },
    });
    expect(probe.calls).toEqual([
      "getRepository",
      "getCurrentActor",
      "getLabels",
      "getRequiredChecks:Acme/Shop:main",
      "getPackageScripts",
      "hasFile:package-lock.json",
    ]);
  });

  it("builds a preview without mutating the probe or repository", async () => {
    const probe = new ReadOnlyProbe();
    const discovery = await discoverSetup(probe);
    const callsBeforePreview = [...probe.calls];

    const preview = buildSetupPreview(discovery);

    expect(probe.calls).toEqual(callsBeforePreview);
    expect(preview.proposedTrustedPbiAuthors).toEqual(["maintainer"]);
    expect(preview.proposedApprovers).toEqual(["maintainer"]);
    expect(preview.labelsToCreate).not.toContain("pbi/refinement");
    expect(preview.labelsToCreate).toContain("agent-in-progress");
    expect(preview.confirmations).toContain(
      "Provide and confirm the demo URL, optional readiness URL, capture command, and artifact directory",
    );
  });

  it("uses only read-only GitHub commands before confirmation", async () => {
    const runner = new RecordingRunner();
    const probe = new GitHubSetupProbe(runner, process.cwd());

    await discoverSetup(probe);

    expect(runner.requests.map(({ executable, args }) => [executable, ...args])).toEqual([
      ["gh", "repo", "view", "--json", "nameWithOwner,defaultBranchRef"],
      ["gh", "api", "user"],
      ["gh", "label", "list", "--limit", "1000", "--json", "name"],
      [
        "gh",
        "api",
        "repos/Acme/Shop/branches/main/protection/required_status_checks",
      ],
    ]);
  });
});