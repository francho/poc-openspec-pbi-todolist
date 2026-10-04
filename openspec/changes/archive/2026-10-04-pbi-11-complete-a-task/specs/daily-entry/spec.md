# Spec Delta

## ADDED Requirements

### Requirement: Complete an existing task

The system SHALL allow a user to mark an existing pending task as completed from the selected day's entry list.

#### Scenario: Mark a pending task as completed

- **WHEN** the user selects the completion checkbox for a pending task
- **THEN** the system records the task as completed, preserves its description, type, date, and identifier, and visibly marks it as completed without reloading the page

#### Scenario: Completed task remains in the day history

- **WHEN** the user views the selected day after completing a task
- **THEN** the completed task remains in the same day's entries alongside other entries

### Requirement: Reopen a completed task

The system SHALL allow a user to clear a completed task's checkbox and return the task to pending status.

#### Scenario: Clear a completed task

- **WHEN** the user clears the completion checkbox for a completed task
- **THEN** the system records the task as pending and visibly removes its completed state without reloading the page

### Requirement: Distinguish task completion states

The system SHALL clearly distinguish completed tasks from pending tasks while displaying them in the same selected-day entry list.

#### Scenario: View pending and completed tasks together

- **WHEN** the selected day contains both pending and completed tasks
- **THEN** the entry list visibly distinguishes the two task states and retains both tasks

### Requirement: Restrict completion to tasks

The system SHALL permit completion state changes only for existing entries of type `task`.

#### Scenario: Attempt to complete a non-task entry

- **WHEN** a completion state change is requested for an event or note
- **THEN** the system rejects the request, leaves the entry unchanged, and reports the failure without changing the day view