# PBI Workflow Operations

This workflow maps one GitHub PBI to exactly one OpenSpec change. GitHub owns the PBI, technical contract, native sub-issues, claims, pull requests, and gate history. The OpenSpec change owns behavioral delta specs and one orchestration checkbox.

## Prerequisites

- Node.js 20.19 or newer and npm.
- OpenSpec 1.13.2 or newer.
- GitHub CLI authenticated for the repository host.
- A non-bare checkout with a GitHub remote, containing `openspec/`, `tools/pbi-workflow/`, the `pbi-driven` schema, the PBI issue form, and all distributed `pbi-*` skills and agents.
- File-write permission in the checkout and GitHub permission to read issues and pull requests, create labels, create and update issues and pull requests, push workflow branches, and enable task auto-merge.

Repository administration remains manual. Setup reports but does not change branch protection, rulesets, required checks, merge policies, or permissions.

## Install and Validate

Build the deterministic tooling from the distributed lockfile:

```bash
cd tools/pbi-workflow
npm ci
npm run build
npm run lint
npm test
cd ../..
```

Validate the distributed OpenSpec schema from the repository root:

```bash
openspec schema validate pbi-driven --verbose
openspec templates --schema pbi-driven --json
```

## Setup

Invoke `setup-pbi-workflow` only after explicitly asking Copilot to install or repair the workflow. Setup first runs discovery and this read-only preview:

```bash
node tools/pbi-workflow/dist/cli.js setup-preview
```

Review the repository, default branch, trusted actors, verification commands, demo policy, required checks, files, labels, and unavailable permissions. Resolve every requested confirmation. No file or GitHub mutation is permitted before accepting that exact preview.

After confirmation, setup writes `.github/pbi-workflow.yaml`, selects `pbi-driven` in `openspec/config.yaml`, and runs:

```bash
node tools/pbi-workflow/dist/cli.js setup-apply --confirm
```

Run preview and apply a second time. The second pass must propose no unexpected file change and create no label. See [configuration.md](configuration.md) for the complete version-1 configuration contract.

## Daily Workflow

1. Create a PBI with the English issue form and complete every required section.
2. Run `/opsx-propose` with the PBI number or canonical URL. Refinement updates only the managed Technical Contract region and waits for a current trusted-human approval event.
3. Proposal generates behavioral delta specs, publishes stable native sub-issues, and creates one local orchestration task.
4. Run `/opsx-apply`. The PBI orchestrator reconstructs GitHub state, owns the run, schedules the ready frontier, and supervises task worktrees, reviews, checks, and squash merges.
5. After every task PR merges, documentation, QA, demo preparation, and trusted demo disposition run for the current integration-branch SHA.
6. Finalization checks the orchestration task, synchronizes durable specs, archives the change, pushes the archive commit, publishes the verified final PR body, and marks the draft PBI PR ready. The final PR is never auto-merged.

## Demo Evidence

For an enabled demo, the demo agent runs the configured startup command, waits for the configured readiness URL, and then runs the exact `demo.capture.command`. The configured command should load the scenarios declared by the active PBI change:

```bash
python -m app.demo --base-url http://127.0.0.1:5055 --scenarios-from-change
```

Each change must provide `openspec/changes/<change>/demo.json` with a non-empty `scenarios` list. The command rejects missing, unknown, duplicate, or ambiguous manifests. It writes a SHA-bound manifest, one directory per scenario, screenshots, and logs below `demo.capture.artifactsDirectory`. A ready report must identify both configured commands and list only repository-relative files from that directory. Finalization includes the validated bundle in the archive commit and links each file from the final pull request. Capturing evidence never grants demo approval; the current trusted-human label event remains required.

## Recovery

Always resume through `/opsx-apply`; do not reconstruct progress from chat history.

| Observed state | Recovery action |
|---|---|
| Another active orchestrator claim | Stop without mutation and let the current owner continue. |
| Expired claim | Inspect its worktree, branch, and PR; preserve dirty work, then resume or requeue. |
| `agent-blocked` task | Resolve its published blocker or approve a scope revision; do not bypass reviews. |
| Open task PR | Resume current-SHA standards and acceptance/spec review, required checks, or its bounded fix cycle. |
| Stale gate after a PBI-branch change | Remove stale projections and rerun that gate and every downstream gate. |
| Blocking completion-gate finding | Reuse or create the stable remediation sub-issue and route it through the normal task PR graph. |
| Demo not applicable | Obtain current trusted-human demo approval; non-applicable preparation alone cannot finalize. |
| Finalization blocked | Leave `tasks.md` unchanged and resolve every reported PR, gate, path, or reference blocker. |
| Final PR ready | Wait for human merge; never enable final auto-merge. |

For a failed setup, restore only files changed by that run and remove only labels created by that run. Restoring the prior `schema` value disables the OpenSpec workflow selection; existing issues, branches, worktrees, and pull requests remain ordinary repository resources.

## MVP Limitations

- One repository, one GitHub PBI, and one OpenSpec change form the workflow boundary; cross-repository mutation is rejected.
- Orchestration is locally supervised and requires a machine with authenticated `gh`, Git, Node.js, and OpenSpec.
- GitHub labels are projections, not approval evidence. Contract and demo approval require current timeline events from configured human users.
- The scheduler supports at most 20 concurrent tasks; the default is three.
- Task integration is squash-only with task auto-merge enabled. Final auto-merge is unsupported.
- Spec synchronization is agent-driven and must complete inline before archive.
- Demo automation uses only configured startup, capture, artifact, URL, readiness, and timeout values. Disabled demos require a recorded reason and human disposition.
- Setup does not configure branch protection, repository rulesets, required checks, permissions, secrets, or external deployment infrastructure.