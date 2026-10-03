---
name: pbi-finalization
description: "Complete and archive an OpenSpec PBI after implementation gates finish. Use when the orchestrator is ready to finalize a PBI; verifies merged task PRs and current-SHA gates, completes the single orchestration checkbox, synchronizes durable specs, archives and pushes the change, then marks the final PR ready without auto-merge."
license: MIT
compatibility: Requires a published PBI task graph, task pull request state, current SHA-bound gate records, and the repository PBI workflow tooling.
metadata:
  author: openspec
  version: "1.0"
---

# Finalize PBI Orchestration

1. Reconstruct task pull requests, gate records, the current PBI integration-branch SHA, and the change's `tasks.md`. Do not trust conversation state or visible labels alone.
2. Invoke the deterministic PBI finalization planner. Require at least one task PR and require every task PR to be merged.
3. Require exactly one current-SHA record for documentation, QA, demo preparation, and demo approval. Documentation, QA, and demo approval must pass. Demo preparation may pass or be justified not-applicable because demo approval records the trusted human disposition.
4. On any blocker, report every blocker and leave `tasks.md` byte-for-byte unchanged. Do not synchronize specs, archive the change, push, or alter final PR readiness.
5. When all conditions pass, replace only the single orchestration checkbox marker from `[ ]` to `[x]`. Preserve all other file content.
6. Revalidate the change strictly. Confirm the current branch is the PBI integration branch, then run the OpenSpec spec-sync workflow inline and archive the completed change on that branch.
7. Include the validated demo evidence bundle in the archive commit. Verify the commit contains durable files under `openspec/specs/`, the moved change under `openspec/changes/archive/`, and every demo artifact referenced by the current-SHA gate under the configured artifact directory. Stop before pushing when any is absent.
8. Push the verified archive commit to the PBI integration branch. Generate the marker-owned final pull request body with PBI linkage, delivered slices, verification evidence, gate summaries, and merge-risk assessment. Supply each demo file as `{ label, path }` so the deterministic renderer links it through the exact archive commit. Resolve every referenced issue, commit, and required check before publishing it.
9. Only after the exact archive commit and verified final body are published, mark the draft PBI pull request ready for human review. Never enable auto-merge for the final PBI pull request.
10. Return the completed task document, current SHA, merged task PRs, gate evidence, archive path, pushed commit, and ready pull request to the orchestrator.

Every step is resumable from repository and GitHub state. Recheck completed effects and continue from the first missing effect without duplicating spec sync, archive commits, pushes, or pull request mutations.