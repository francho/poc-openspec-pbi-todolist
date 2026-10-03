# PBI Workflow Configuration

The repository configuration lives at `.github/pbi-workflow.yaml`. Version `1` accepts only English workflow artifacts and deliberately rejects unknown keys so misspellings cannot silently disable controls.

For installation, permissions, recovery, and operating procedures, see [operations.md](operations.md).

## Required Values

- `version`: Must be `1`.
- `trusted.pbiAuthors`: At least one GitHub user or team allowed to author PBIs without an additional trust decision.
- `trusted.approvers`: At least one GitHub user or team allowed to approve technical contracts and demos.
- `verification`: Explicit settings for install, format, lint, typecheck, test, and build.
- `demo.start`: The configured start command or a disabled setting with a reason.
- `demo.capture`: For enabled demos, the exact evidence command and its repository-relative artifact directory. The command should select scenarios from the active PBI change rather than hard-code a particular PBI's scenarios.

Every command setting has one of these forms:

```yaml
enabled: true
command: npm test
```

```yaml
enabled: false
reason: This repository has no automated test suite
```

Agents must report disabled checks and their reasons. They must not infer or silently omit commands.

## Defaults

Omitted optional sections receive these defaults:

- Language: `en`.
- PBI branch: `feature/pbi-{pbi-number}-{slug}`.
- Task branch: `task/{sub-issue-number}-{slug}`.
- Parallel tasks: `3`.
- Lease: `120` minutes.
- Stale claims: `requeue`.
- Review cycles: `3`.
- Task merge: automatic squash.
- Final PR merge: always manual.
- Startup timeout: `60` seconds.
- Labels: the `pbi/*`, `agent-*`, and `gate/*` names defined by the workflow design.

Enabling demo startup also requires `demo.url` and `demo.capture`. `demo.readinessUrl` is optional. Capture artifact directories must be normalized repository-relative paths without `.` or `..` segments.

Each PBI change declares its demo scenarios in `openspec/changes/<change>/demo.json`, for example `{ "scenarios": ["create-entry"] }`. The capture command can use `--scenarios-from-change`; when more than one active change exists, set `OPENSPEC_CHANGE_NAME` to select the PBI explicitly.

## Labels

Labels project persisted workflow state for people and automation. They do not replace structured managed records, current-SHA gate evidence, or GitHub timeline actor history.

### PBI State

| Default label | Meaning |
|---|---|
| `pbi/refinement` | Technical refinement is active. |
| `pbi/awaiting-contract-approval` | The current Technical Contract revision awaits trusted-human approval. |
| `pbi/planned` | Contract, specs, and task graph are ready. |
| `pbi/implementation` | Delivery slices are being implemented. |
| `pbi/documentation-review` | The current integration SHA is in documentation review. |
| `pbi/qa` | The current integration SHA is in QA. |
| `pbi/demo` | Demo preparation or disposition is active. |
| `pbi/ready-for-pr` | Finalization may prepare the final PR. |
| `pbi/pr-open` | The final PBI PR is open for human review. |
| `pbi/done` | The final PBI PR merged. |
| `pbi/blocked` | A workflow-level blocker requires resolution. |

### Task State

| Default label | Meaning |
|---|---|
| `ready-for-agent` | Dependencies are merged and the slice may be claimed. |
| `agent-in-progress` | A valid claim owns active implementation. |
| `agent-pr-open` | The task PR is open for review and checks. |
| `agent-merged` | The task PR was squash-merged into the PBI branch. |
| `agent-blocked` | Implementation or bounded review repair cannot continue automatically. |
| `agent-stalled` | The prior claim expired and requires recovery. |

### Gate Projection

| Default label | Meaning |
|---|---|
| `gate/contract-approved` | The current contract revision has trusted-human approval. |
| `gate/documentation-passed` | Documentation passed for the current PBI head SHA. |
| `gate/qa-passed` | QA passed for the current PBI head SHA. |
| `gate/demo-ready` | Reproducible demo evidence is ready for the current SHA. |
| `gate/demo-not-applicable` | Demo preparation recorded a justified non-applicable result. |
| `gate/demo-approved` | A trusted human approved the current demo evidence or non-applicable disposition. |

Any integration-branch change makes earlier completion-gate projections stale. The orchestrator removes stale labels and relies on structured gate records to choose reruns.

## Validation Rules

- Unknown keys, duplicate YAML keys, unsupported versions, and non-English workflow configuration are errors.
- Branch patterns must retain their required placeholders.
- Every verification command is explicitly enabled with a command or disabled with a reason.
- Trusted author and approver lists cannot be empty.
- Task merge remains squash with auto-merge enabled; final auto-merge must remain disabled.
- Enabled demos require a URL and capture configuration. Startup timeout must be between 1 and 900 seconds.
- Parallelism, leases, and review cycles must stay within the schema bounds reported by configuration validation.

## Example

See `test/fixtures/config/valid.yaml` for the smallest complete configuration. Setup may propose additional required checks and demo values discovered from the target repository, but it stores them only after user confirmation.