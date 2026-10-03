import { z } from "zod";

import type { WorkflowConfig } from "./config.js";
import { requireTrustedLabelApproval } from "./trusted-approval.js";
import type { LabelHistoryEvent, TrustedLabelApproval } from "./trusted-approval.js";

export const demoReportSchema = z.object({
  headSha: z.string().regex(/^[0-9a-f]{40}$/u),
  disposition: z.enum(["ready", "failed", "not-applicable"]),
  startCommand: z.string().min(1).optional(),
  captureCommand: z.string().min(1).optional(),
  url: z.url().optional(),
  readinessUrl: z.url().optional(),
  readinessObserved: z.boolean(),
  evidence: z.array(z.string().min(1)),
  findings: z.array(z.string().min(1)),
  justification: z.string().min(1).optional(),
}).strict();

export type DemoReport = z.infer<typeof demoReportSchema>;

export interface DemoApproval extends TrustedLabelApproval {
  readonly headSha: string;
}

function isConfiguredArtifact(path: string, directory: string): boolean {
  const segments = path.split("/");
  return path.startsWith(`${directory}/`)
    && !path.includes("\\")
    && segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function approveDemo(
  headSha: string,
  observedHeadSha: string,
  events: readonly LabelHistoryEvent[],
  approvalLabel: string,
  trustedApprovers: readonly string[],
  demoEvidenceUpdatedAt: string,
): DemoApproval {
  if (headSha !== observedHeadSha) throw new Error(`PBI head changed: expected ${headSha}, received ${observedHeadSha}`);
  return { ...requireTrustedLabelApproval(events, approvalLabel, trustedApprovers, demoEvidenceUpdatedAt), headSha };
}

export function validateDemoReport(input: unknown, config: WorkflowConfig): DemoReport {
  const report = demoReportSchema.parse(input);
  if (config.demo.start.enabled) {
    if (report.disposition === "not-applicable") throw new Error("Configured demos cannot become not applicable automatically");
    if (report.startCommand !== config.demo.start.command || report.url !== config.demo.url) {
      throw new Error("Demo report did not use the configured start command and URL");
    }
    if (report.captureCommand !== config.demo.capture?.command) {
      throw new Error("Demo report did not use the configured capture command");
    }
    if (config.demo.readinessUrl !== undefined && report.readinessUrl !== config.demo.readinessUrl) {
      throw new Error("Demo report did not use the configured readiness URL");
    }
    if (report.disposition === "ready" && (!report.readinessObserved || report.evidence.length === 0 || report.findings.length > 0)) {
      throw new Error("Ready demo requires readiness, evidence, and no findings");
    }
    if (report.disposition === "ready"
      && report.evidence.some((path) => !isConfiguredArtifact(path, config.demo.capture!.artifactsDirectory))) {
      throw new Error("Ready demo evidence must remain under the configured artifact directory");
    }
  } else {
    if (report.disposition !== "not-applicable") throw new Error("Disabled demo must be reported as not applicable");
    if (report.justification !== config.demo.start.reason || report.evidence.length === 0) {
      throw new Error("Not-applicable demo requires the configured reason and supporting evidence");
    }
  }
  return report;
}