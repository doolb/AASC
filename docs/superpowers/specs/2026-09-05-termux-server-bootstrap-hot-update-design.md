# Termux Server Bootstrap and Hot Update Design

## Goal

Allow the fixed AASC main server to publish a verifiable server-code package and allow a Termux node to install it through a one-shot Bootstrap while preserving the existing two-process launcher/service model.

## Architecture

The main server exposes a JSON manifest at `GET /server` and a streamed gzip package at `GET /server/package`. The package contains only runtime source and lock files. The Termux Bootstrap is a dependency-free CommonJS Node.js command (`aasc-server-bootstrap.cjs`) with `run` and `update` modes: `run` owns the existing launcher lifecycle, while `update` stops the service, installs a staged package, restarts it, checks health, and restores the prior code on failure.

The existing Termux directory remains the project root so that current configuration and resource path assumptions continue to work. Updates replace only the code whitelist in place, merge-copy `src/` so excluded local subdirectories survive, and copy the previous whitelist to a rollback directory.

## Package contract

```text
GET /server
→ { status: "success", manifest: {
      version, size, sha256, packageUrl,
   files: ["src", "package.json", "package-lock.json"]
   }}

GET /server/package
→ application/gzip stream
```

The package excludes `logs/`, `3rd/`, `node_modules/`, user configuration, media, task runtime data, models, and certificates. The current release is cached by the release service and invalidated when the configured release version changes.

## Update state machine

```text
idle
  → downloading
  → verifying
  → staging
  → stopping
  → backing_up
  → installing
  → starting
  → checking
  → completed

checking --failure→ rolling_back → starting → failed
```

The SHA-256 and byte count are checked before the service stops. Extraction is confined to a staging directory. A failed health check restores only the previous code whitelist; configuration, media, dependencies, certificates, and logs remain untouched.

## Process model

```text
Bootstrap/launcher process
  └── fork server-app.js service process
```

`update` is not the runit service. It invokes the service controller (`sv stop`/`sv start`) or injected direct process callbacks in tests. No third permanent process is introduced.

## Acceptance

- Unit tests cover manifest/package boundaries, hash/size rejection, staging safety, success, and rollback.
- Existing Node tests remain green except the known DeX input contract.
- The connected Termux device starts the node, registers/heartbeats to the fixed main server, completes a valid hot update, and recovers from an intentionally invalid package.
