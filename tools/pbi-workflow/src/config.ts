import { parseDocument } from "yaml";
import { z } from "zod";

const labelNameSchema = z.string().trim().min(1).max(50);

const commandConfigSchema = z.discriminatedUnion("enabled", [
  z
    .object({
      enabled: z.literal(true),
      command: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      enabled: z.literal(false),
      reason: z.string().trim().min(1),
    })
    .strict(),
]);

const repositoryRelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (path) => !path.startsWith("/")
      && !path.includes("\\")
      && !/^[A-Za-z]:/u.test(path)
      && path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".."),
    "Path must be a normalized repository-relative path",
  );

const demoCaptureSchema = z
  .object({
    command: z.string().trim().min(1),
    artifactsDirectory: repositoryRelativePathSchema,
  })
  .strict();

const pbiLabelsSchema = z
  .object({
    refinement: labelNameSchema.default("pbi/refinement"),
    awaitingContractApproval: labelNameSchema.default(
      "pbi/awaiting-contract-approval",
    ),
    planned: labelNameSchema.default("pbi/planned"),
    implementation: labelNameSchema.default("pbi/implementation"),
    documentationReview: labelNameSchema.default("pbi/documentation-review"),
    qa: labelNameSchema.default("pbi/qa"),
    demo: labelNameSchema.default("pbi/demo"),
    readyForPr: labelNameSchema.default("pbi/ready-for-pr"),
    prOpen: labelNameSchema.default("pbi/pr-open"),
    done: labelNameSchema.default("pbi/done"),
    blocked: labelNameSchema.default("pbi/blocked"),
  })
  .strict();

const taskLabelsSchema = z
  .object({
    ready: labelNameSchema.default("ready-for-agent"),
    inProgress: labelNameSchema.default("agent-in-progress"),
    prOpen: labelNameSchema.default("agent-pr-open"),
    merged: labelNameSchema.default("agent-merged"),
    blocked: labelNameSchema.default("agent-blocked"),
    stalled: labelNameSchema.default("agent-stalled"),
  })
  .strict();

const gateLabelsSchema = z
  .object({
    contractApproved: labelNameSchema.default("gate/contract-approved"),
    documentationPassed: labelNameSchema.default("gate/documentation-passed"),
    qaPassed: labelNameSchema.default("gate/qa-passed"),
    demoReady: labelNameSchema.default("gate/demo-ready"),
    demoApproved: labelNameSchema.default("gate/demo-approved"),
    demoNotApplicable: labelNameSchema.default("gate/demo-not-applicable"),
  })
  .strict();

function branchPatternSchema(requiredTokens: readonly string[]) {
  return z
    .string()
    .trim()
    .min(1)
    .superRefine((pattern, context) => {
      for (const token of requiredTokens) {
        if (!pattern.includes(`{${token}}`)) {
          context.addIssue({
            code: "custom",
            message: `Branch pattern must include {${token}}`,
          });
        }
      }
    });
}

export const workflowConfigSchema = z
  .object({
    version: z.literal(1),
    language: z.literal("en").default("en"),
    trusted: z
      .object({
        pbiAuthors: z.array(z.string().trim().min(1)).min(1),
        approvers: z.array(z.string().trim().min(1)).min(1),
      })
      .strict(),
    labels: z
      .object({
        pbi: pbiLabelsSchema.prefault({}),
        task: taskLabelsSchema.prefault({}),
        gate: gateLabelsSchema.prefault({}),
      })
      .strict()
      .prefault({}),
    branches: z
      .object({
        pbi: branchPatternSchema(["pbi-number", "slug"]).default(
          "feature/pbi-{pbi-number}-{slug}",
        ),
        task: branchPatternSchema(["sub-issue-number", "slug"]).default(
          "task/{sub-issue-number}-{slug}",
        ),
      })
      .strict()
      .prefault({}),
    orchestration: z
      .object({
        maxParallelTasks: z.number().int().min(1).max(20).default(3),
        leaseMinutes: z.number().int().min(5).max(1440).default(120),
        staleClaimPolicy: z.literal("requeue").default("requeue"),
        maxReviewCycles: z.number().int().min(1).max(10).default(3),
      })
      .strict()
      .prefault({}),
    verification: z
      .object({
        install: commandConfigSchema,
        format: commandConfigSchema,
        lint: commandConfigSchema,
        typecheck: commandConfigSchema,
        test: commandConfigSchema,
        build: commandConfigSchema,
      })
      .strict(),
    demo: z
      .object({
        start: commandConfigSchema,
        capture: demoCaptureSchema.optional(),
        url: z.url().optional(),
        readinessUrl: z.url().optional(),
        startupTimeoutSeconds: z.number().int().min(1).max(900).default(60),
      })
      .strict()
      .superRefine((demo, context) => {
        if (demo.start.enabled && demo.url === undefined) {
          context.addIssue({
            code: "custom",
            path: ["url"],
            message: "Demo URL is required when the start command is enabled",
          });
        }
        if (demo.start.enabled && demo.capture === undefined) {
          context.addIssue({
            code: "custom",
            path: ["capture"],
            message: "Demo capture configuration is required when the start command is enabled",
          });
        }
      }),
    pullRequests: z
      .object({
        requiredChecks: z.array(z.string().trim().min(1)).default([]),
        taskMergeMethod: z.literal("squash").default("squash"),
        taskAutoMerge: z.literal(true).default(true),
        finalAutoMerge: z.literal(false).default(false),
      })
      .strict()
      .prefault({}),
  })
  .strict();

export type WorkflowConfig = z.infer<typeof workflowConfigSchema>;
export type CommandConfig = z.infer<typeof commandConfigSchema>;

export interface ConfigValidationIssue {
  readonly path: string;
  readonly message: string;
}

export class ConfigValidationError extends Error {
  readonly issues: readonly ConfigValidationIssue[];

  constructor(issues: readonly ConfigValidationIssue[]) {
    super(
      `Invalid PBI workflow configuration:\n${issues
        .map((issue) => `- ${issue.path}: ${issue.message}`)
        .join("\n")}`,
    );
    this.name = "ConfigValidationError";
    this.issues = issues;
  }
}

function formatPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return "$";
  }

  return path.reduce<string>((result, segment) => {
    if (typeof segment === "number") {
      return `${result}[${segment}]`;
    }

    const value = String(segment);
    return result === "$" ? `$.${value}` : `${result}.${value}`;
  }, "$" as string);
}

export function parseWorkflowConfig(input: unknown): WorkflowConfig {
  const result = workflowConfigSchema.safeParse(input);
  if (!result.success) {
    throw new ConfigValidationError(
      result.error.issues.map((issue) => ({
        path: formatPath(issue.path),
        message: issue.message,
      })),
    );
  }

  return result.data;
}

export function parseWorkflowConfigYaml(source: string): WorkflowConfig {
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new ConfigValidationError(
      document.errors.map((error) => ({ path: "$", message: error.message })),
    );
  }

  return parseWorkflowConfig(document.toJS({ maxAliasCount: 0 }));
}