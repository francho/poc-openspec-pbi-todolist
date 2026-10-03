import { upsertManagedBlock } from "./markers.js";
import type { GateName, GateVerdict } from "./state.js";

export interface DeliveredSliceSummary {
  readonly id: string;
  readonly title: string;
  readonly issueUrl: string;
  readonly commitSha: string;
}

export interface VerificationSummary {
  readonly name: string;
  readonly checkUrl: string;
  readonly evidence: string;
}

export interface FinalGateSummary {
  readonly gate: Exclude<GateName, "contract">;
  readonly verdict: GateVerdict;
  readonly evidence: readonly string[];
}

export interface DemoArtifactEvidence {
  readonly label: string;
  readonly path: string;
}

export interface FinalPullRequestBodyInput {
  readonly existingBody: string;
  readonly pbiNumber: number;
  readonly pbiUrl: string;
  readonly archiveCommitSha: string;
  readonly slices: readonly DeliveredSliceSummary[];
  readonly verification: readonly VerificationSummary[];
  readonly gates: readonly FinalGateSummary[];
  readonly demoEvidence: readonly (string | DemoArtifactEvidence)[];
  readonly mergeRisk: { readonly level: "low" | "medium" | "high"; readonly assessment: string };
}

export interface FinalReferenceResolver {
  issueResolves(url: string): Promise<boolean>;
  commitResolves(sha: string): Promise<boolean>;
  checkResolves(url: string): Promise<boolean>;
}

export class FinalPullRequestBodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinalPullRequestBodyError";
  }
}

async function requireResolution(
  kind: "issue" | "commit" | "check",
  reference: string,
  resolves: (reference: string) => Promise<boolean>,
): Promise<void> {
  if (!await resolves(reference)) throw new FinalPullRequestBodyError(`Unresolved ${kind} reference: ${reference}`);
}

function bullet(value: string): string {
  return value.replaceAll("\n", " ").replace(/[\\[\]()`*_<>]/gu, "\\$&").trim();
}

function githubReference(value: string, repository: string, kind: "issues" | "checks"): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "github.com") return false;
    const escapedRepository = repository.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const suffix = kind === "issues" ? "issues/\\d+" : "(?:actions/runs/\\d+|commit/[0-9a-f]{40}/checks)";
    return new RegExp(`^/${escapedRepository}/${suffix}/?$`, "u").test(url.pathname) && url.search === "" && url.hash === "";
  } catch {
    return false;
  }
}

function demoArtifactUrl(repository: string, archiveCommitSha: string, evidence: DemoArtifactEvidence): string {
  const path = evidence.path.trim();
  if (evidence.label.trim().length === 0) throw new FinalPullRequestBodyError("Demo artifact label is required");
  if (!path.startsWith("artifacts/")
    || path.includes("\\")
    || path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new FinalPullRequestBodyError(`Invalid demo artifact path: ${evidence.path}`);
  }
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${repository}/blob/${archiveCommitSha}/${encodedPath}`;
}

export async function renderFinalPullRequestBody(
  input: FinalPullRequestBodyInput,
  resolver: FinalReferenceResolver,
): Promise<string> {
  if (!Number.isInteger(input.pbiNumber) || input.pbiNumber <= 0) {
    throw new FinalPullRequestBodyError(`Invalid PBI number: ${input.pbiNumber}`);
  }
  if (input.slices.length === 0) throw new FinalPullRequestBodyError("At least one delivered slice is required");
  if (input.verification.length === 0) throw new FinalPullRequestBodyError("At least one verification check is required");
  if (input.gates.length === 0) throw new FinalPullRequestBodyError("At least one gate summary is required");
  if (input.demoEvidence.length === 0) throw new FinalPullRequestBodyError("Demo evidence is required");
  if (input.mergeRisk.assessment.trim().length === 0) throw new FinalPullRequestBodyError("Merge-risk assessment is required");

  const pbiMatch = /^https:\/\/github\.com\/(?<repository>[^/]+\/[^/]+)\/issues\/\d+$/u.exec(input.pbiUrl);
  const repository = pbiMatch?.groups?.repository;
  if (repository === undefined || !githubReference(input.pbiUrl, repository, "issues")) {
    throw new FinalPullRequestBodyError(`Invalid canonical PBI reference: ${input.pbiUrl}`);
  }
  if (!/^[0-9a-f]{40}$/u.test(input.archiveCommitSha)) {
    throw new FinalPullRequestBodyError(`Invalid archive commit reference: ${input.archiveCommitSha}`);
  }
  for (const slice of input.slices) {
    if (!githubReference(slice.issueUrl, repository, "issues")) {
      throw new FinalPullRequestBodyError(`Invalid slice issue reference: ${slice.issueUrl}`);
    }
    if (!/^[0-9a-f]{40}$/u.test(slice.commitSha)) {
      throw new FinalPullRequestBodyError(`Invalid slice commit reference: ${slice.commitSha}`);
    }
  }
  for (const check of input.verification) {
    if (!githubReference(check.checkUrl, repository, "checks")) {
      throw new FinalPullRequestBodyError(`Invalid check reference: ${check.checkUrl}`);
    }
  }
  for (const evidence of input.demoEvidence) {
    if (typeof evidence !== "string") demoArtifactUrl(repository, input.archiveCommitSha, evidence);
  }

  await requireResolution("issue", input.pbiUrl, resolver.issueResolves.bind(resolver));
  await requireResolution("commit", input.archiveCommitSha, resolver.commitResolves.bind(resolver));
  for (const slice of input.slices) {
    await requireResolution("issue", slice.issueUrl, resolver.issueResolves.bind(resolver));
    await requireResolution("commit", slice.commitSha, resolver.commitResolves.bind(resolver));
  }
  for (const check of input.verification) {
    await requireResolution("check", check.checkUrl, resolver.checkResolves.bind(resolver));
  }

  const content = [
    `## PBI`,
    `- Resolves [#${input.pbiNumber}](${input.pbiUrl})`,
    `- Archive commit: \`${input.archiveCommitSha}\``,
    "",
    "## Delivered Slices",
    ...input.slices.map((slice) => `- ${slice.id}: [${bullet(slice.title)}](${slice.issueUrl}) at \`${slice.commitSha}\``),
    "",
    "## Verification",
    ...input.verification.map((check) => `- [${bullet(check.name)}](${check.checkUrl}): ${bullet(check.evidence)}`),
    "",
    "## Completion Gates",
    ...input.gates.map((gate) => `- ${gate.gate}: **${gate.verdict}** - ${gate.evidence.map(bullet).join("; ")}`),
    "",
    "## Demo Evidence",
    ...input.demoEvidence.map((evidence) => typeof evidence === "string"
      ? `- ${bullet(evidence)}`
      : `- [${bullet(evidence.label)}](${demoArtifactUrl(repository, input.archiveCommitSha, evidence)})`),
    "",
    "## Merge Risk",
    `- **${input.mergeRisk.level}**: ${bullet(input.mergeRisk.assessment)}`,
  ].join("\n");

  return upsertManagedBlock(input.existingBody, "pull-request", `pbi-${input.pbiNumber}`, content);
}