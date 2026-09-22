# Offline MMD Static Proxy Design

## Goal

Allow an already installed Offline APK to render the existing Miya PMX/VMD resource without embedding any model binary, by extending the local Node service with the same fixed-upstream proxy posture used for the static VRM model.

## Scope

The fixed release is `miya-v1` at `http://c.aasc.us/mnt/mmd/miya-v1/`. The server profile, source allowlist and proxy behavior change; the Android app, APK profiles, APK assets, binary models, local persistence and remote-control configuration do not.

## Architecture

`GET /api/mmd/resources` first attempts the existing local manifest. If and only if the manifest file is absent, it returns a pinned static Miya profile whose PMX and VMD URLs use `/api/mmd/static/mmd/...`. The prefix is essential: Three.js resolves PMX texture names relative to the PMX URL, so `tex/1.png` remains a same-origin `/api/mmd/static/mmd/miya/tex/1.png` request.

`GET /api/mmd/static/*` decodes and validates the requested relative path against a compiled release definition containing exactly the 14 model resources, their byte lengths and SHA-256 values. It resolves only `c.aasc.us` to an IPv4 address, constructs only the fixed `miya-v1` root URL, reads the bounded upstream payload, verifies HTTP 200, content length and digest, then sends the full verified body with a fixed MIME type. It never follows redirects, writes a file, returns a partial payload or accepts a caller-supplied host, release, query path or filename.

## Error Handling

No local manifest means static-profile fallback. A malformed or locally inconsistent manifest remains a 503 because silently switching sources would conceal a deployment problem. Unknown static paths are 404. DNS, timeout, upstream status, size and SHA mismatch become structured 502 responses. The browser MMD runtime preserves its existing placeholder failure path; no chat, media or lighting state is reset.

## Testing

Tests must first prove that no current static profile or path proxy exists, then cover local precedence, missing-only fallback, exact URL composition, IP resolution, all forbidden path forms, unexpected upstream sizes/statuses/hashes and browser acceptance only of the two same-origin MMD prefixes. Package tests must prove no PMX, VMD or texture path is added to Offline Runtime files or APK assets.

## Release Boundary

The work is delivered by the existing service code update mechanism only. This task must not run `build:apk:offline`, `build:apk:offline:min`, `build:offline-update` or any publish command. A future explicit release task may package and publish the already-tested code.
