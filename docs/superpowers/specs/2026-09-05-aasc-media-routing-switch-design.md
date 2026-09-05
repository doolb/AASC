# AASC Media Index, Display-First Routing, and Manual Server Switching

## Scope

This batch implements three independent but compatible AASC capabilities: local/remote media index aggregation, opt-in display-first task routing, and browser-level manual server switching. Authentication, discovery, nearest-node selection, failover, and media file replication remain out of scope.

## Design

Each server exposes a local media index endpoint. The main server reads indexes from online registered nodes and returns source-scoped records with owner URLs; the media bytes remain on the owner server. The task router is deterministic and opt-in: explicit targets win, `display-first`/`auto` checks online display capabilities, and no match falls back to the current server process. The server page navigates the browser to an owner’s `/upload` route and also accepts a validated manual HTTP(S) address.

## Failure handling

An unavailable media source is reported in `errors` without discarding local or other remote sources. A task with no matching display remains executable locally. An invalid switch address is rejected without navigation. No authentication is introduced in this batch.

## Verification

Unit and source-contract tests cover index normalization/aggregation, route decisions, task integration, and URL switching. Existing media, task, WebSocket, and server-list tests remain part of the regression suite.
