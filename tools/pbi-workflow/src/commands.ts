import { spawn } from "node:child_process";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { z } from "zod";

export interface CommandRequest {
  readonly executable: "gh" | "git" | "openspec";
  readonly args: readonly string[];
  readonly cwd: string;
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandRunner {
  run(request: CommandRequest): Promise<CommandResult>;
}

const credentialPatterns = [
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/gu,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/gu,
  /\bBearer\s+[^\s]+/giu,
  /\btoken[=:]\s*[^\s]+/giu,
];

export function redactSecrets(value: string): string {
  return credentialPatterns.reduce(
    (redacted, pattern) => redacted.replace(pattern, "[REDACTED]"),
    value,
  );
}

export class CommandExecutionError extends Error {
  constructor(
    readonly executable: CommandRequest["executable"],
    readonly exitCode: number,
    stderr: string,
  ) {
    super(`${executable} exited with code ${exitCode}: ${redactSecrets(stderr).trim()}`);
    this.name = "CommandExecutionError";
  }
}

export class ExternalDataError extends Error {
  constructor(
    readonly source: string,
    message: string,
  ) {
    super(`Invalid ${source} data: ${redactSecrets(message)}`);
    this.name = "ExternalDataError";
  }
}

export class RepositoryScopeError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`Repository scope violation: expected ${expected}, received ${actual}`);
    this.name = "RepositoryScopeError";
  }
}

function normalizeRepository(repository: string): string {
  const normalized = repository.trim().toLowerCase();
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/u.test(normalized)) {
    throw new RepositoryScopeError("owner/repository", repository);
  }
  return normalized;
}

export function assertRepositoryScope(expected: string, actual: string): void {
  const normalizedExpected = normalizeRepository(expected);
  const normalizedActual = normalizeRepository(actual);
  if (normalizedExpected !== normalizedActual) {
    throw new RepositoryScopeError(normalizedExpected, normalizedActual);
  }
}

export function resolveRepositoryPath(root: string, path: string): string {
  const repositoryRoot = resolve(root);
  const destination = resolve(repositoryRoot, path);
  const relativePath = relative(repositoryRoot, destination);
  if (relativePath === "" || isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
    throw new RepositoryScopeError(repositoryRoot, path);
  }
  return destination;
}

export function parseExternalJson<Schema extends z.ZodType>(
  source: string,
  schema: Schema,
  sourceName: string,
): z.output<Schema> {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ExternalDataError(sourceName, message);
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ExternalDataError(sourceName, z.prettifyError(result.error));
  }
  return result.data;
}

export class NodeCommandRunner implements CommandRunner {
  run(request: CommandRequest): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(request.executable, [...request.args], {
        cwd: request.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.once("error", reject);
      child.once("close", (exitCode) => {
        resolve({ exitCode: exitCode ?? 1, stdout, stderr });
      });
    });
  }
}

abstract class CommandClient {
  constructor(
    protected readonly runner: CommandRunner,
    protected readonly cwd: string,
  ) {}

  protected async execute(
    executable: CommandRequest["executable"],
    args: readonly string[],
  ): Promise<string> {
    const result = await this.runner.run({ executable, args, cwd: this.cwd });
    if (result.exitCode !== 0) {
      throw new CommandExecutionError(executable, result.exitCode, result.stderr);
    }
    return result.stdout;
  }
}

const gitHubIssueSchema = z
  .object({
    number: z.number().int().positive(),
    title: z.string(),
    url: z.url(),
    state: z.enum(["OPEN", "CLOSED"]),
    body: z.string(),
    author: z.object({ login: z.string().min(1) }).strip(),
  })
  .strict();

export type GitHubIssue = z.infer<typeof gitHubIssueSchema>;

export class GitHubClient extends CommandClient {
  readonly repository: string;

  constructor(runner: CommandRunner, cwd: string, repository: string) {
    super(runner, cwd);
    this.repository = normalizeRepository(repository);
  }

  async getIssue(issueNumber: number): Promise<GitHubIssue> {
    if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
      throw new ExternalDataError("GitHub issue number", String(issueNumber));
    }
    const stdout = await this.execute("gh", [
      "issue",
      "view",
      String(issueNumber),
      "--repo",
      this.repository,
      "--json",
      "number,title,url,state,body,author",
    ]);
    return parseExternalJson(stdout, gitHubIssueSchema, "GitHub issue");
  }
}

export class GitClient extends CommandClient {
  run(args: readonly string[]): Promise<string> {
    return this.execute("git", args);
  }
}

export class OpenSpecClient extends CommandClient {
  async runJson<Schema extends z.ZodType>(
    args: readonly string[],
    schema: Schema,
  ): Promise<z.output<Schema>> {
    const stdout = await this.execute("openspec", [...args, "--json"]);
    return parseExternalJson(stdout, schema, "OpenSpec");
  }
}