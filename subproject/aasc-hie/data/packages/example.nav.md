# AASC-HIE example navigation package

This package demonstrates a complete, game-agnostic daily navigation target.
The runtime state and progress are kept outside this document; this file is
the immutable, reviewable navigation design.

```navigation-json
{
  "metadata": {
    "id": "example-package",
    "name": "Example navigation package",
    "version": "1.0.0",
    "navigators": ["ui", "map-2.5d"],
    "scenarios": ["daily"]
  },
  "scenarios": [
    { "id": "daily", "priority": 500 }
  ],
  "goals": [
    {
      "id": "daily-routine",
      "kind": "compound",
      "period": "daily",
      "scenarioId": "daily",
      "steps": [
        { "id": "open-routine", "kind": "ui", "flowId": "open-routine" },
        { "id": "finish-routine", "kind": "ui", "flowId": "finish-routine" }
      ]
    },
    {
      "id": "reach-arena",
      "kind": "map-2.5d",
      "spaceModel": "moba-25d",
      "navmeshId": "arena",
      "target": { "x": 1, "z": 2 }
    }
  ],
  "states": [
    {
      "id": "routine-screen",
      "uis": ["home", "routine"],
      "topmost": "routine",
      "matches": [{ "assetId": "routine-icon", "threshold": 0.86 }]
    },
    {
      "id": "manual-login",
      "uis": ["login"],
      "topmost": "login",
      "matches": [{ "assetId": "login-icon", "threshold": 0.9 }]
    }
  ],
  "flows": [
    {
      "id": "open-routine",
      "scenarioId": "daily",
      "steps": [
        { "id": "tap-routine", "kind": "action", "assetId": "routine-icon", "action": { "action": "tap", "point": { "x": 100, "y": 100 } }, "nextStateId": "routine-screen" }
      ]
    },
    {
      "id": "finish-routine",
      "scenarioId": "daily",
      "steps": [
        { "id": "manual-account-login", "kind": "handoff", "action": { "action": "manual", "reason": "account-login" }, "stateId": "manual-login" },
        { "id": "submit-routine", "kind": "action", "action": { "action": "tap", "point": { "x": 200, "y": 200 } }, "stateId": "routine-screen" }
      ],
      "repair": { "source": "intelligence", "candidate": true, "reason": "daily-subgoal-missing" }
    }
  ],
  "rules": {
    "hero": { "movementSpeed": 300 }
  },
  "alerts": [
    {
      "id": "enemy-nearby",
      "when": "distance(self, nearestEnemyHero) < 450",
      "severity": "warning",
      "message": "Enemy nearby",
      "suggestedGoal": "reach-arena"
    },
    {
      "id": "navigation-gap-review",
      "when": "gapQueue.pending > 0",
      "severity": "info",
      "priority": 20,
      "message": "A navigation gap needs review"
    }
  ],
  "navmeshes": [
    { "id": "arena", "file": "maps/arena.navmesh", "spaceModel": "moba-25d" }
  ]
}
```

The image and NavMesh resources are intentionally independent package data.

![routine-icon Routine icon](data:image/png;base64,aW1hZ2U=)
![login-icon Login icon](data:image/png;base64,aW1hZ2U=)
