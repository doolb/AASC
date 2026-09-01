# Chat history persistence safety design

## Decision

Keep the existing AASC server and user configuration directory for now. Fix the destructive persistence behavior first: a normal history save must never delete files merely because the current in-memory snapshot does not contain them. Destructive operations require an explicit scope and create a protected backup before mutation.

Add one previous-day `aasc-user` configuration snapshot, JSON export/import, atomic writes, and explicit persistence logs. Request-level test isolation is intentionally deferred.

## Main flows

```text
chat mutation
    -> mark affected history file
    -> debounce for 2 seconds
    -> write non-empty current files and explicitly changed empty files
    -> leave unrelated files untouched

clear/delete/replace import
    -> validate explicit scope
    -> backup current history
    -> mutate selected scope
    -> atomic save
```

The backup directory contains only the latest previous-day `aasc-user` snapshot. Import merge is the safe UI default; replace is an explicit service operation and is always preceded by a backup. Runtime logs and process files are excluded from the snapshot.

## Safety boundaries

- Empty `clearHistory({})` is rejected.
- Normal saves have no stale-file deletion pass.
- A non-empty on-disk file is not replaced by an empty in-memory snapshot unless that file is explicitly marked changed.
- The existing Pi/Chat2API stores are not treated as UI history and are not imported automatically.

## Deferred work

Live automated tests still use the existing server and can add test messages. A future `testOnly/testRunId` namespace can prevent persistence, but it is not part of this change.
