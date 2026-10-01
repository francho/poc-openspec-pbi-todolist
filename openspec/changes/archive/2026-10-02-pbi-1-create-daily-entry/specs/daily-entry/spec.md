# Spec Delta

## Purpose

Provide a single-user daily journal capability for creating and viewing task, event, and note entries associated with a selected calendar day.

## ADDED Requirements

### Requirement: Create daily entries

The system SHALL allow a user to create a daily entry with a description and one supported type: task, event, or note.

#### Scenario: Create a task

- **WHEN** the user is viewing a day and creates an entry with a description and the type `task`
- **THEN** the system adds a task entry to that day

#### Scenario: Create an event

- **WHEN** the user is viewing a day and creates an entry with a description and the type `event`
- **THEN** the system adds an event entry to that day

#### Scenario: Create a note

- **WHEN** the user is viewing a day and creates an entry with a description and the type `note`
- **THEN** the system adds a note entry to that day

### Requirement: Validate entry data

The system SHALL reject an entry that does not have a non-empty description or does not have one of the supported types.

#### Scenario: Missing description

- **WHEN** the user submits an entry without a description
- **THEN** the system does not create the entry and shows a validation message

#### Scenario: Unsupported type

- **WHEN** the user submits an entry without a supported type
- **THEN** the system does not create the entry and shows a validation message

### Requirement: Associate entries with one calendar day

The system SHALL associate each entry with exactly one selected calendar day represented as an ISO `YYYY-MM-DD` date.

#### Scenario: Entry belongs to the selected day

- **WHEN** the user creates an entry for a selected day
- **THEN** the system associates the entry with that day only

### Requirement: Retain created entries

The system SHALL retain a successfully created entry so that it remains available when the user views its associated day again.

#### Scenario: View a retained entry

- **WHEN** the user returns to the day associated with a previously created entry
- **THEN** the system displays that entry with its description and type
