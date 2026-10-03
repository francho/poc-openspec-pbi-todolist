### User Story

As a repository maintainer,
I want repeatable release notes,
so that users can understand each release.

### Context

Release information is currently assembled manually and inconsistently.

### Scope

Generate release notes from merged pull requests for each tagged release.

### Acceptance Criteria

- [ ] Given merged pull requests, when a release is tagged, then categorized release notes are generated.

### Related Documentation

https://docs.github.com/en/repositories/releasing-projects-on-github

### Constraints

The workflow must use the repository's existing GitHub permissions.

### Out of Scope

Publishing packages to external registries.