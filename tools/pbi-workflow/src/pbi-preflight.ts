import type { GitHubIssue } from "./commands.js";
import { requiredPbiFields } from "./pbi-fields.js";
import type { PbiFieldId } from "./pbi-fields.js";

export interface PbiPreflightOptions {
  readonly trustedAuthors: readonly string[];
  readonly trustedApprovers: readonly string[];
  readonly authorApproval?: { readonly approvedBy: string };
}

export interface PbiPreflightFinding {
  readonly code: string;
  readonly field?: PbiFieldId;
  readonly message: string;
}

export interface PbiPreflightResult {
  readonly accepted: boolean;
  readonly sections: Readonly<Partial<Record<PbiFieldId, string>>>;
  readonly findings: readonly PbiPreflightFinding[];
}

export interface PbiIssueReader {
  getIssue(issueNumber: number): Promise<GitHubIssue>;
}

const placeholderPattern = /\b(?:TODO|TBD|FIXME|CHANGEME)\b|\?{3,}|<[^>\n]+>|\{[^}\n]+\}/iu;
const englishWords = /\b(?:a|an|and|as|be|by|for|from|given|in|is|must|of|or|so|that|the|then|to|when|with)\b/giu;
const nonEnglishWords = /\b(?:como|con|cuando|de|el|en|entonces|es|la|los|para|por|que|se|una|y)\b/giu;

function parseSections(body: string): {
  sections: Partial<Record<PbiFieldId, string>>;
  duplicateFields: PbiFieldId[];
} {
  const cleaned = body.replace(/<!--[\s\S]*?-->/gu, "");
  const matches = [...cleaned.matchAll(/^#{2,3}\s+(.+?)\s*$/gmu)];
  const sections: Partial<Record<PbiFieldId, string>> = {};
  const duplicateFields: PbiFieldId[] = [];
  for (const field of requiredPbiFields) {
    const fieldMatches = matches.filter((match) => match[1]?.trim() === field.heading);
    if (fieldMatches.length > 1) duplicateFields.push(field.id);
    const match = fieldMatches[0];
    if (match?.index === undefined) continue;
    const next = matches.find((candidate) => (candidate.index ?? 0) > match.index!);
    const start = match.index + match[0].length;
    sections[field.id] = cleaned.slice(start, next?.index ?? cleaned.length).trim();
  }
  return { sections, duplicateFields };
}

function normalizedItems(value: string): Set<string> {
  return new Set(
    value
      .split("\n")
      .map((line) => line.replace(/^\s*[-*]\s*(?:\[[ xX]\]\s*)?/u, "").trim().toLowerCase().replace(/[.!]$/u, ""))
      .filter((line) => line.length > 0),
  );
}

function isEnglish(body: string): boolean {
  const text = body.replace(/https?:\/\/\S+/gu, "");
  const english = text.match(englishWords)?.length ?? 0;
  const nonEnglish = text.match(nonEnglishWords)?.length ?? 0;
  return english >= 3 && english > nonEnglish;
}

export function validatePbiPreflight(
  issue: GitHubIssue,
  options: PbiPreflightOptions,
): PbiPreflightResult {
  const findings: PbiPreflightFinding[] = [];
  if (issue.state !== "OPEN") {
    findings.push({ code: "issue-closed", message: "Reopen the PBI before refinement." });
  }
  const trustedAuthor = options.trustedAuthors.includes(issue.author.login);
  const approval = options.authorApproval;
  const trustedApproval = approval !== undefined && options.trustedApprovers.includes(approval.approvedBy);
  if (!trustedAuthor && !trustedApproval) {
    findings.push({ code: "untrusted-author", message: `Author ${issue.author.login} is not trusted; obtain explicit approval from a configured approver.` });
  }

  const { sections, duplicateFields } = parseSections(issue.body);
  for (const field of requiredPbiFields) {
    const value = sections[field.id];
    if (value === undefined || value.trim() === "") {
      findings.push({ code: "missing-section", field: field.id, message: `Complete the ${field.heading} section.` });
    } else if (placeholderPattern.test(value)) {
      findings.push({ code: "unresolved-placeholder", field: field.id, message: `Replace unresolved placeholders in ${field.heading}.` });
    }
  }
  for (const field of duplicateFields) {
    findings.push({ code: "duplicate-section", field, message: `Keep exactly one ${requiredPbiFields.find((item) => item.id === field)!.heading} section.` });
  }
  if (!isEnglish(issue.body)) {
    findings.push({ code: "not-english", message: "Write the PBI content in English." });
  }

  const story = sections["user-story"] ?? "";
  if (!/^As an? [^,\n]+,\s*\n?I want [^,\n]+,\s*\n?so that [^.\n]+\.$/isu.test(story)) {
    findings.push({ code: "invalid-user-story", field: "user-story", message: "Use a concrete 'As a ..., I want ..., so that ....' user story." });
  }
  const acceptance = sections["acceptance-criteria"] ?? "";
  const criteria = acceptance.split("\n").filter((line) => /^\s*[-*]\s*(?:\[[ xX]\]\s*)?/u.test(line));
  if (criteria.length === 0 || criteria.some((line) => !/\bgiven\b.+\bwhen\b.+\bthen\b/iu.test(line))) {
    findings.push({ code: "untestable-acceptance-criteria", field: "acceptance-criteria", message: "Provide checklist criteria with observable Given/When/Then outcomes." });
  }
  const documentation = sections["related-documentation"] ?? "";
  if (!/https?:\/\/\S+/u.test(documentation) && !/^Not applicable:\s*\S.+/iu.test(documentation)) {
    findings.push({ code: "invalid-documentation", field: "related-documentation", message: "Add a documentation URL or 'Not applicable:' with a justification." });
  }
  const scope = normalizedItems(sections.scope ?? "");
  const outOfScope = normalizedItems(sections["out-of-scope"] ?? "");
  const contradictions = [...scope].filter((item) => outOfScope.has(item));
  if (contradictions.length > 0) {
    findings.push({ code: "scope-contradiction", field: "out-of-scope", message: `Remove items listed in both Scope and Out of Scope: ${contradictions.join(", ")}.` });
  }

  return { accepted: findings.length === 0, sections, findings };
}

export async function retrieveAndValidatePbi(
  reader: PbiIssueReader,
  issueNumber: number,
  options: PbiPreflightOptions,
): Promise<PbiPreflightResult> {
  return validatePbiPreflight(await reader.getIssue(issueNumber), options);
}