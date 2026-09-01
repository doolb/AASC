# Chat history persistence safety implementation plan

> **For agentic workers:** implement with tests first and preserve unrelated dirty worktree changes.

**Goal:** Prevent normal chat saves or tests from deleting private history, add a single previous-day `aasc-user` configuration snapshot, and provide chat/configuration import/export while keeping the existing server connection and configuration directory.

**Architecture:** Extract file/backup/import primitives into `chat-history-store.js`; keep session-key and message routing in `llm-service.js`. The service tracks explicitly changed history files so an empty file is written only after a deliberate clear/delete. The control UI uses JSON download/upload endpoints.

## Implementation steps

1. Add failing store tests for stale-file preservation, explicit empty-file writes, atomic save, previous-day full-directory snapshot, chat/config export envelopes, merge deduplication, and replace validation.
2. Implement the store and wire `llm-service.js` to track changed files, validate clear scopes, and log destructive operations.
3. Add HTTP export/import endpoints and make WebSocket clear requests pass an explicit scope.
4. Add control-panel export/import buttons and reload history after a successful import.
5. Run focused tests, syntax checks and existing chat/private-session tests.
6. Update project docs, leave automated test isolation in `todo.md`, and do not commit unrelated logs or generated files.

## Files

- Create `src/external/llm/chat-history-store.js`
- Create `src/external/llm/chat-history-store.test.js`
- Modify `src/external/llm/llm-service.js`
- Modify `src/apps/server/boot/server-app.js`
- Modify `src/apps/web-mediacenter/ui/public/js/chat.js`
- Create `src/apps/web-mediacenter/ui/public/js/aasc-user-config.js`
- Modify `src/apps/web-mediacenter/ui/public/upload.html`
- Modify `docs/design.md`, `docs/spec.md`, `docs/design/chat-system.md`, `docs/spec/chat-system.md`, `docs/todo.md`, `changelog.md`
- Create `docs/design/chat-history-persistence.md`, `docs/spec/chat-history-persistence.md`, and the task record
