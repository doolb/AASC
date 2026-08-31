# Chat2API Global Responses Design

## Decision

Use one AASC-owned Responses transport for ordinary chat, voice chat, search, and one-shot LLM tasks. Point Pi Agent at the same `/v1/responses` endpoint through its `openai-responses` API. Keep AI role Codex/Claude backends and old profile credentials unchanged as rollback data, then stop only the external `/mnt/Chat2API` process tree after live verification.

## State model

The existing AASC chat session key remains the application-level identity. A small local mapping stores the Responses `conversation` ID, latest `response_id`, model, and an input fingerprint. The first request sends the local context; later requests send only the new input plus the prior Responses identifier. If the state is missing, stale, or rejected by the proxy, the client rebuilds a Responses conversation from the local history.

## Boundaries

- `llm-responses-client.js` owns HTTP, JSON, SSE, and normalized errors.
- `llm-service.js` owns AASC chat history and maps application sessions to Responses sessions.
- `llm-chat.js` uses the client for one-shot task requests and does not share ordinary chat state.
- `pi-readonly-tools.mjs` owns Pi API selection and conversion of Responses function calls to Pi tool events.
- `chat2api` remains the Provider/account/session implementation and is not replaced by a second proxy.

## Compatibility

The global setting is persisted as `protocol: "openai-responses"` with the built-in proxy base URL. Existing `apiUrl`, API keys, profiles, and Chat Completions route remain available for rollback and external clients. AI role backends are explicitly excluded.

## Verification

Acceptance requires real non-streaming and streaming ordinary chat, one continuation after restart, a search/one-shot task request, a Pi Agent tool loop, and confirmation that the external Electron process is gone while the built-in proxy remains healthy.
