# Runtime data

All game-specific and mutable project data lives under this directory. Code
and reusable interfaces remain under src/.

## Layout

- packages/ contains Markdown navigation packages.
- navmesh/maps/ contains independent NavMesh JSON documents.
- models/ contains local model registrations and model metadata.
- progress/ contains runtime progress snapshots.
- rules/ contains validated rule-data notes.
- legacy-source/ contains byte-preserving copies from the retired project.

Navigation packages and NavMesh files are separate resources. A package may
refer to a NavMesh using its safe relative resource path, but the NavMesh
store owns the map file and its revisions.

The legacy package copies under packages/legacy/ are normalized for the
current parser. The original files remain under legacy-source/ for audit;
they are not used as live runtime inputs.
