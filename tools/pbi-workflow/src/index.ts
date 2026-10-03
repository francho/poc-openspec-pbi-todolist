export {
	ConfigValidationError,
	parseWorkflowConfig,
	parseWorkflowConfigYaml,
	workflowConfigSchema,
} from "./config.js";
export type {
	CommandConfig,
	ConfigValidationIssue,
	WorkflowConfig,
} from "./config.js";
export {
	InvalidStateTransitionError,
	StateLabelConflictError,
	assertPbiTransition,
	assertTaskTransition,
	canTransitionPbi,
	canTransitionTask,
	resolveExclusiveState,
} from "./state.js";
export type {
	Claim,
	GateName,
	GateRecord,
	GateVerdict,
	Pbi,
	PbiState,
	PullRequestState,
	Slice,
	TaskState,
} from "./state.js";
export {
	ManagedMarkerError,
	parseManagedBlocks,
	renderManagedBlock,
	upsertManagedBlock,
} from "./markers.js";
export type { ManagedBlock, ManagedKind } from "./markers.js";
export {
	ReconciliationError,
	planReconciliation,
} from "./reconciliation.js";
export type {
	DesiredResource,
	ExistingResource,
	ReconciliationAction,
} from "./reconciliation.js";
export {
	CommandExecutionError,
	ExternalDataError,
	GitClient,
	GitHubClient,
	NodeCommandRunner,
	OpenSpecClient,
	RepositoryScopeError,
	assertRepositoryScope,
	parseExternalJson,
	redactSecrets,
	resolveRepositoryPath,
} from "./commands.js";
export type {
	CommandRequest,
	CommandResult,
	CommandRunner,
	GitHubIssue,
} from "./commands.js";
export { requiredPbiFields } from "./pbi-fields.js";
export type { PbiFieldId } from "./pbi-fields.js";
export { retrieveAndValidatePbi, validatePbiPreflight } from "./pbi-preflight.js";
export type { PbiPreflightFinding, PbiPreflightOptions, PbiPreflightResult } from "./pbi-preflight.js";
export { PbiIdentityConflictError, derivePbiChangeName, resolvePbiChange } from "./pbi-identity.js";
export type { PbiChangeResolution } from "./pbi-identity.js";
export {
	PbiRevisionConflictError,
	TechnicalContractError,
	approveTechnicalContract,
	computePbiRevision,
	isContractApprovalCurrent,
	renderTechnicalContract,
	updateTechnicalContract,
} from "./technical-contract.js";
export type { ContractApproval, ContractSlice, TechnicalContract } from "./technical-contract.js";
export { TaskGraphConflictError, publishTaskGraph, renderSliceIssue } from "./task-graph.js";
export type { DeliverySlice, PublishedSliceIssue, TaskGraphGitHub, TaskGraphPublicationResult } from "./task-graph.js";
export { TaskPublicationNotVerifiedError, renderOrchestrationTask } from "./orchestration-task.js";
export {
	ClaimValidationError,
	createClaim,
	isClaimStale,
	parseClaims,
	renderClaim,
	resolveOwnership,
} from "./claims.js";
export type { OwnershipResolution } from "./claims.js";
export { DependencyGraphError, calculateReadyFrontier, scheduleReadyTasks } from "./scheduler.js";
export type { ReadyFrontier, SchedulerSlice } from "./scheduler.js";
export { GitWorktreeManager, WorktreeConflictError } from "./worktrees.js";
export type { TaskWorktree, WorktreeCleanupResult } from "./worktrees.js";
export {
	PullRequestConflictError,
	ensureDraftPbiPullRequest,
	ensureTaskPullRequest,
} from "./pull-requests.js";
export type { PullRequestCreateInput, PullRequestGitHub, PullRequestRecord } from "./pull-requests.js";
export { parseReviewResult, reviewAcceptanceAndSpecs, reviewFindingSchema, reviewResultSchema } from "./reviews.js";
export type { ComplianceEvidence, ComplianceReviewInput, ComplianceTarget, ReviewFinding, ReviewResult } from "./reviews.js";
export { evaluateReviewCycle, renderReviewPublication } from "./review-cycles.js";
export type { CheckResult, ReviewCycleDecision } from "./review-cycles.js";
export { newlyReadyAfterMerge, planTaskMerge } from "./task-merge.js";
export type { Mergeability, TaskMergePlan } from "./task-merge.js";
export { documentationReviewSchema, validateDocumentationReview } from "./documentation-review.js";
export type { DocumentationReview } from "./documentation-review.js";
export { qaReportSchema, validateQaReport } from "./qa.js";
export type { QaReport } from "./qa.js";
export { demoReportSchema, validateDemoReport } from "./demo.js";
export type { DemoReport } from "./demo.js";
export { parseGateRecords, projectGateLabels, renderGateRecord } from "./gates.js";
export type { GateProjection } from "./gates.js";
export { gatesToRerunAfterRemediation, publishRemediation, remediationKey } from "./remediation.js";
export type { RemediationFinding, RemediationPublication } from "./remediation.js";
export { requireTrustedLabelApproval, TrustedApprovalError } from "./trusted-approval.js";
export type { LabelHistoryEvent, TrustedLabelApproval } from "./trusted-approval.js";
export { planPbiFinalization } from "./finalization.js";
export type { FinalizationGate, PbiFinalizationPlan } from "./finalization.js";
export { ArchiveFinalizationError, completePbiArchive } from "./archive-finalization.js";
export type { ArchiveResult, PbiArchiveCompletion, PbiArchiveOperations } from "./archive-finalization.js";
export { FinalPullRequestBodyError, renderFinalPullRequestBody } from "./final-pr-body.js";
export type {
	DemoArtifactEvidence,
	DeliveredSliceSummary,
	FinalGateSummary,
	FinalPullRequestBodyInput,
	FinalReferenceResolver,
	VerificationSummary,
} from "./final-pr-body.js";
export { buildResumeDiagnostics } from "./resume-diagnostics.js";
export type { ClaimedSlice, ResumeDiagnostics, ResumeNextAction } from "./resume-diagnostics.js";
export {
	GitHubSetupProbe,
	buildSetupPreview,
	discoverSetup,
} from "./setup-discovery.js";
export type {
	DetectedCommands,
	SetupDiscovery,
	SetupPreview,
	SetupProbe,
} from "./setup-discovery.js";
export {
	SetupConfirmationRequiredError,
	reconcileSetup,
	selectOpenSpecSchema,
} from "./setup-reconciliation.js";
export type {
	SetupManifest,
	SetupReconciliationResult,
	SetupTarget,
} from "./setup-reconciliation.js";
export { RepositorySetupTarget, loadSetupManifest } from "./setup-runtime.js";

export const packageName = "@openspec/pbi-workflow";
export const packageVersion = "0.1.0";