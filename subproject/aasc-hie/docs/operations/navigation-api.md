# Navigation Data API

A human, script, or large-model client uses the same JSON API. The author
and source fields are provenance, not a separate capability or endpoint.

## Run the service

The host application creates a NavigationPackageRepository, loads a package,
and passes its NavigationDataService to createNavigationHttpService.
Authentication is injected separately:

~~~js
const repository = new NavigationPackageRepository();
const packageService = new NavigationDataService({ repository });
await packageService.load('data/packages/honor-of-kings.nav.md');
const service = createNavigationHttpService({ packageService, runtime, auth });
~~~

In a configured host process, use:

~~~sh
npm run nav-serve -- --host 127.0.0.1 --port 8787 --dry-run
~~~

## Package mutation

~~~http
POST /api/v1/packages/honor-of-kings/operations
Content-Type: application/json
~~~

~~~json
{
  "author": { "kind": "external-client", "name": "llm" },
  "source": { "url": "https://example.com/rules", "version": "sample-1" },
  "baseRevision": 0,
  "operations": [
    {
      "op": "add",
      "path": "/rules/hero/movementSpeed",
      "value": 350
    }
  ]
}
~~~

The response is a candidate revision. Validate it, then publish that exact
repository-created envelope:

~~~http
POST /api/v1/packages/honor-of-kings/validate
POST /api/v1/packages/honor-of-kings/publish
~~~

Every mutation is checked for base-revision conflicts, safe JSON Pointer paths,
package references, image data URLs, NavMesh references, and source
provenance. Runtime use begins only after publication.

## NavMesh and runtime requests

~~~http
POST /api/v1/navmesh/honor-of-kings-25d/observations
POST /api/v1/navmesh/honor-of-kings-25d/rebuild
GET  /api/v1/runtime/state
POST /api/v1/runtime/observations
POST /api/v1/runtime/simulate
GET  /api/v1/runtime/alerts
GET  /api/v1/runtime/goals
PUT  /api/v1/runtime/goal
GET  /api/v1/runtime/gaps
GET  /api/v1/runtime/chain
POST /api/v1/runtime/command
~~~

The NavMesh is stored independently from Markdown package data. Runtime
responses expose state versions, game time, confidence, previews, alerts,
chains, and command results. Commands are rejected when expired, stale,
low-confidence, or execution is disabled.

## Preview versus execution

Use the chain and command endpoints for a side-effect-free preview:

~~~http
GET /api/v1/runtime/chain
POST /api/v1/runtime/command
{"execute":false}
~~~

The command endpoint returns a validated candidate and does not call ADB when
`execute` is false. Live execution additionally requires an injected executor,
an explicitly selected device, host authentication, and the runtime execution
switch.

When muscle memory cannot find a configured route, the runtime adds a
`NavigationGap`. Pending and resolved gaps are exposed by the gaps endpoint.
The intelligence layer may propose package operations, but rejected operations
are recorded as events and are never written.
