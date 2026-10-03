import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import {
  CommandExecutionError,
  parseExternalJson,
} from "./commands.js";
import type { CommandRequest, CommandRunner } from "./commands.js";

const workflowLabels = [
  "pbi/refinement",
  "pbi/awaiting-contract-approval",
  "pbi/planned",
  "pbi/implementation",
  "pbi/documentation-review",
  "pbi/qa",
  "pbi/demo",
  "pbi/ready-for-pr",
  "pbi/pr-open",
  "pbi/done",
  "pbi/blocked",
  "ready-for-agent",
  "agent-in-progress",
  "agent-pr-open",
  "agent-merged",
  "agent-blocked",
  "agent-stalled",
  "gate/contract-approved",
  "gate/documentation-passed",
  "gate/qa-passed",
  "gate/demo-ready",
  "gate/demo-approved",
  "gate/demo-not-applicable",
] as const;

export interface DetectedCommands {
  readonly install?: string;
  readonly format?: string;
  readonly lint?: string;
  readonly typecheck?: string;
  readonly test?: string;
  readonly build?: string;
  readonly demoStart?: string;
}

export interface SetupDiscovery {
  readonly repository: string;
  readonly defaultBranch: string;
  readonly currentActor: string;
  readonly existingLabels: readonly string[];
  readonly requiredChecks: readonly string[];
  readonly commands: DetectedCommands;
}

export interface SetupProbe {
  getRepository(): Promise<{ readonly nameWithOwner: string; readonly defaultBranch: string }>;
  getCurrentActor(): Promise<string>;
  getLabels(): Promise<readonly string[]>;
  getRequiredChecks(repository: string, branch: string): Promise<readonly string[]>;
  getPackageScripts(): Promise<Readonly<Record<string, string>>>;
  hasFile(path: string): Promise<boolean>;
}

export interface SetupPreview {
  readonly repository: string;
  readonly defaultBranch: string;
  readonly proposedTrustedPbiAuthors: readonly string[];
  readonly proposedApprovers: readonly string[];
  readonly labelsToCreate: readonly string[];
  readonly requiredChecks: readonly string[];
  readonly commands: DetectedCommands;
  readonly confirmations: readonly string[];
}

function detectScript(
  scripts: Readonly<Record<string, string>>,
  names: readonly string[],
): string | undefined {
  const name = names.find((candidate) => scripts[candidate] !== undefined);
  return name === undefined ? undefined : `npm run ${name}`;
}

export async function discoverSetup(probe: SetupProbe): Promise<SetupDiscovery> {
  const repository = await probe.getRepository();
  const [currentActor, existingLabels, requiredChecks, scripts, hasNpmLock] =
    await Promise.all([
      probe.getCurrentActor(),
      probe.getLabels(),
      probe.getRequiredChecks(repository.nameWithOwner, repository.defaultBranch),
      probe.getPackageScripts(),
      probe.hasFile("package-lock.json"),
    ]);
  const format = detectScript(scripts, ["format:check", "format-check"]);
  const lint = detectScript(scripts, ["lint"]);
  const typecheck = detectScript(scripts, ["typecheck", "type-check"]);
  const test = detectScript(scripts, ["test"]);
  const build = detectScript(scripts, ["build"]);
  const demoStart = detectScript(scripts, ["dev", "start"]);

  return {
    repository: repository.nameWithOwner.toLowerCase(),
    defaultBranch: repository.defaultBranch,
    currentActor,
    existingLabels,
    requiredChecks,
    commands: {
      ...(Object.keys(scripts).length > 0
        ? { install: hasNpmLock ? "npm ci" : "npm install" }
        : {}),
      ...(format === undefined ? {} : { format }),
      ...(lint === undefined ? {} : { lint }),
      ...(typecheck === undefined ? {} : { typecheck }),
      ...(test === undefined ? {} : { test }),
      ...(build === undefined ? {} : { build }),
      ...(demoStart === undefined ? {} : { demoStart }),
    },
  };
}

export function buildSetupPreview(discovery: SetupDiscovery): SetupPreview {
  const existing = new Set(discovery.existingLabels);
  const confirmations = [
    "Confirm trusted PBI authors",
    "Confirm trusted contract and demo approvers",
    "Confirm every detected or disabled verification command",
  ];
  if (discovery.commands.demoStart !== undefined) {
    confirmations.push("Provide and confirm the demo URL, optional readiness URL, capture command, and artifact directory");
  }

  return {
    repository: discovery.repository,
    defaultBranch: discovery.defaultBranch,
    proposedTrustedPbiAuthors: [discovery.currentActor],
    proposedApprovers: [discovery.currentActor],
    labelsToCreate: workflowLabels.filter((label) => !existing.has(label)),
    requiredChecks: discovery.requiredChecks,
    commands: discovery.commands,
    confirmations,
  };
}

const repositorySchema = z
  .object({
    nameWithOwner: z.string().regex(/^[^/]+\/[^/]+$/u),
    defaultBranchRef: z.object({ name: z.string().min(1) }).strict(),
  })
  .strict();
const actorSchema = z.object({ login: z.string().min(1) }).passthrough();
const labelsSchema = z.array(z.object({ name: z.string().min(1) }).passthrough());
const checksSchema = z
  .object({
    contexts: z.array(z.string()).optional(),
    checks: z.array(z.object({ context: z.string() }).passthrough()).optional(),
  })
  .passthrough();
const packageSchema = z
  .object({ scripts: z.record(z.string(), z.string()).optional() })
  .passthrough();

export class GitHubSetupProbe implements SetupProbe {
  constructor(
    private readonly runner: CommandRunner,
    private readonly cwd: string,
  ) {}

  private async readGh(args: readonly string[]): Promise<string> {
    const result = await this.runner.run({ executable: "gh", args, cwd: this.cwd });
    if (result.exitCode !== 0) {
      throw new CommandExecutionError("gh", result.exitCode, result.stderr);
    }
    return result.stdout;
  }

  async getRepository(): Promise<{
    readonly nameWithOwner: string;
    readonly defaultBranch: string;
  }> {
    const stdout = await this.readGh([
      "repo",
      "view",
      "--json",
      "nameWithOwner,defaultBranchRef",
    ]);
    const repository = parseExternalJson(stdout, repositorySchema, "GitHub repository");
    return {
      nameWithOwner: repository.nameWithOwner,
      defaultBranch: repository.defaultBranchRef.name,
    };
  }

  async getCurrentActor(): Promise<string> {
    const stdout = await this.readGh(["api", "user"]);
    return parseExternalJson(stdout, actorSchema, "GitHub actor").login;
  }

  async getLabels(): Promise<readonly string[]> {
    const stdout = await this.readGh([
      "label",
      "list",
      "--limit",
      "1000",
      "--json",
      "name",
    ]);
    return parseExternalJson(stdout, labelsSchema, "GitHub labels").map(
      (label) => label.name,
    );
  }

  async getRequiredChecks(
    repository: string,
    branch: string,
  ): Promise<readonly string[]> {
    const request: CommandRequest = {
      executable: "gh",
      args: [
        "api",
        `repos/${repository}/branches/${encodeURIComponent(branch)}/protection/required_status_checks`,
      ],
      cwd: this.cwd,
    };
    const result = await this.runner.run(request);
    if (result.exitCode !== 0) {
      if (/404|Branch not protected/iu.test(result.stderr)) {
        return [];
      }
      throw new CommandExecutionError("gh", result.exitCode, result.stderr);
    }
    const checks = parseExternalJson(result.stdout, checksSchema, "required checks");
    return [
      ...(checks.contexts ?? []),
      ...(checks.checks ?? []).map((check) => check.context),
    ].filter((value, index, values) => values.indexOf(value) === index);
  }

  async getPackageScripts(): Promise<Readonly<Record<string, string>>> {
    try {
      const source = await readFile(join(this.cwd, "package.json"), "utf8");
      return parseExternalJson(source, packageSchema, "package.json").scripts ?? {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {};
      }
      throw error;
    }
  }

  async hasFile(path: string): Promise<boolean> {
    try {
      await access(join(this.cwd, path), constants.F_OK);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }
}