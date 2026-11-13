# Migration data layout

The Honor of Kings sample uses one Markdown navigation package at `data/packages/honor-of-kings.nav.md`. Its UI states, flows, goals, alerts, and model IDs are configuration data. It does not depend on a legacy `flows/` directory.

The map is independent binary-like JSON data at `data/navmesh/maps/honor-of-kings-25d.navmesh`. A package references it using the safe relative path `maps/honor-of-kings-25d.navmesh`; the `NavMeshStore` owns revisions and writes the mesh separately from Markdown.

The checked-in map is a training/sample revision. It is suitable for exercising path planning and visualization, not for claiming game-accurate coordinates. New observations should be submitted through the normal `NavigationDataService.apply()` or NavMesh observation API and reviewed before publication.

## Current game packages

All game navigation packages are now stored directly under `data/packages/` as single Markdown files:

- `data/packages/honor-of-kings.nav.md`
- `data/packages/netease-cloud-infinity-nikki.nav.md`
- `data/packages/tower-of-fantasy-weekly.nav.md`

Each package contains its UI states, flows, goals, recognition rules, and embedded Base64 image assets. NavMesh data remains independent under `data/navmesh/maps/` and is referenced by package ID and relative path. Historical model registrations and progress snapshots remain available as data imports, but are not navigation packages.
