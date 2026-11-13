# Browser Host

A browser host supplies the same frame, observation, and command contracts as
an Android host. Browser-specific code belongs in adapters; computation and
package semantics remain unchanged.

## Adapter boundary

~~~js
const browserExecutor = new BrowserExecutor({
  driver: {
    async click(point) { /* browser host input */ },
    async drag(from, to, durationMs) { /* browser host input */ },
  },
});
~~~

The recognizer returns normalized observations, including observedAt,
gameTimeHint, UI layers, entities, map observations, and confidence. It never
clicks the browser or chooses a goal. The runtime then applies the same
state-version, expiry, confidence, and dry-run checks used by the ADB path.

## Safety

Keep browser execution disabled while validating a package or replaying
recorded observations. Enable it only after the host supplies an authenticated
driver and an explicit execution policy. A browser tab or DOM selector is
runtime adapter data; it must not be embedded in generic computation modules.
