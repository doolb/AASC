# Server API Usage CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a source-aligned HTTP API catalog and safe, AI-friendly Bash commands for common AASC server operations.

**Architecture:** Keep all business protocols unchanged. Put curl, URL, HTTPS, timeout, JSON, and HTTP error handling in one sourced Bash helper; make operation scripts thin wrappers and expose a generic caller for every documented route. Use stdout JSON, stderr errors, nonzero exit codes, and explicit confirmation for destructive operations.

**Tech Stack:** Bash 4+, curl, jq when available, Node.js fallback for JSON escaping, Node `node:test`, existing Express HTTP routes.

**Spec:** `docs/spec/api-usage.md` and `docs/design/api-usage.md`

## Global Constraints

- Default URL is `https://127.0.0.1:8081`, overridden by `AASC_URL`.
- `AASC_INSECURE=1` permits the project’s local self-signed HTTPS certificate; set it to `0` for normal certificate verification.
- Successful command output is JSON on stdout; errors are on stderr with a nonzero exit status.
- `run-all.sh` only calls read-only health/status endpoints.
- Do not add passwords, cookies, tokens, or other secrets to scripts or documentation.
- Use `apply_patch` for repository edits and preserve unrelated worktree changes.

### Task 1: Add the API usage design, spec, task record, and indexes

**Files:**
- Create: `docs/design/api-usage.md`
- Create: `docs/spec/api-usage.md`
- Create: `docs/task/2026-09-02_服务器API文档与命令行脚本.md`
- Create: `docs/superpowers/plans/2026-09-02-api-usage-cli.md`
- Modify: `docs/design.md`, `docs/spec.md`, `docs/usage.md`, `docs/todo.md`

**Interfaces:**
- Produces the fixed CLI contract and script names used by Tasks 2–4.

- [x] **Step 1: Write the design and pseudocode before implementation.**
- [x] **Step 2: Record the affected modules, tests, compatibility, and risks.**
- [x] **Step 3: Review the route inventory against `server-app.js`, `log-brain-api.js`, and the Chat2API gateway.**

### Task 2: Add failing static CLI contract tests

**Files:**
- Create: `tests/api-cli-contract.test.js`

**Interfaces:**
- Consumes the script names and command contract from Task 1.
- Produces a static regression test for Tasks 3 and 4.

- [x] **Step 1: Write assertions for required scripts, Bash safety flags, common helper sourcing, help flags, operation paths, and `npm run api:test`.**
- [x] **Step 2: Run `node --test tests/api-cli-contract.test.js` and confirm it fails because the scripts and package entry do not exist.**

### Task 3: Implement shared helper and generic API caller

**Files:**
- Create: `scripts/api-tests/common.sh`
- Create: `scripts/api-tests/api-request.sh`
- Modify: `package.json`

**Interfaces:**
- `common.sh`: `api_request METHOD PATH CURL_ARGS...`, `api_json_string TEXT`, and common environment variables.
- `api-request.sh`: `METHOD PATH [--json JSON] [--form key=value] [--file key=FILE] [--header HEADER] [--confirm]`.

- [x] **Step 1: Implement URL normalization and curl status/error handling.**
- [x] **Step 2: Implement JSON escaping with jq-first and Node fallback.**
- [x] **Step 3: Implement generic JSON/multipart argument parsing and destructive confirmation.**
- [x] **Step 4: Add `api:test` to `package.json` and keep it as a shell entry point.**
- [x] **Step 5: Run the static contract test and verify the shared layer is green.**

### Task 4: Implement common operation scripts

**Files:**
- Create: `scripts/api-tests/health.sh`
- Create: `scripts/api-tests/media-list.sh`
- Create: `scripts/api-tests/play.sh`
- Create: `scripts/api-tests/tts-generate.sh`
- Create: `scripts/api-tests/asr-recognize.sh`
- Create: `scripts/api-tests/vision-ocr.sh`
- Create: `scripts/api-tests/vision-yolo.sh`
- Create: `scripts/api-tests/run-all.sh`

**Interfaces:**
- `play.sh --file FILE --display DISPLAY_ID` → `POST /upload-file`.
- `tts-generate.sh --text TEXT [--voice VOICE] [--speed NUMBER]` → `POST /api/tts/generate`.
- `asr-recognize.sh --audio FILE` → `POST /api/asr/recognize`.
- `vision-ocr.sh --image FILE [--display DISPLAY_ID] [--short-side PIXELS]` → `POST /api/vision/ocr`.
- `vision-yolo.sh --image FILE [--display DISPLAY_ID]` → `POST /api/vision/yolo`.
- `run-all.sh` → JSON Lines from read-only probes.

- [x] **Step 1: Implement argument validation and `--help` for every operation.**
- [x] **Step 2: Implement file upload and JSON request wrappers without storing file bytes in shell variables.**
- [x] **Step 3: Implement OCR short-side validation and leave YOLO without a scaling flag.**
- [x] **Step 4: Implement safe read-only probe aggregation.**
- [x] **Step 5: Re-run static tests.**

### Task 5: Write complete API usage documentation

**Files:**
- Create: `docs/api-usage.md`
- Modify: `docs/usage.md`, `docs/todo.md`, `docs/design/api-usage.md`, `docs/spec/api-usage.md`, `docs/task/2026-09-02_服务器API文档与命令行脚本.md`, `changelog.md`

**Interfaces:**
- Documents every stable HTTP route grouped by status, media, voice, vision, config, chat, reminders, media libraries, diagnostics, device state, and model downloads.
- Documents WebSocket-only task/control boundaries and generic CLI invocation.

- [x] **Step 1: Copy the verified route inventory into the API catalog.**
- [x] **Step 2: Add working curl and script examples for playback, TTS, ASR, OCR, YOLO, and generic calls.**
- [x] **Step 3: Record safe/dangerous behavior and AI parsing rules.**

### Task 6: Verify locally and commit

**Files:**
- Test: `tests/api-cli-contract.test.js`
- Verify: all scripts under `scripts/api-tests/`

- [x] **Step 1: Run `--help` for each script and verify no help command invokes curl.**
- [x] **Step 2: Run Node static tests, shell syntax checks, and `git diff --check`.**
- [x] **Step 3: Run safe API probes against the local server.**
- [x] **Step 4: Run available TTS/ASR/vision file tests and record unavailable capabilities as results, not failures of the scripts.**
- [x] **Step 5: Remove the completed task from `docs/todo.md`, update `changelog.md`, and commit only intended files.**
