'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { AascServerRouteManager } = require('../src/framework/aasc/server-route-manager');

function createRouteHarness() {
    let nodes = [
        { nodeId: 'main-server', name: '主服务器', status: 'online' },
        { nodeId: 'termux-subserver', name: 'Termux 子服务器', status: 'online' }
    ];
    const changes = [];
    const manager = new AascServerRouteManager({
        getNodes: () => nodes,
        onChange: (current, previous) => changes.push({ current, previous }),
        setInterval: () => 1,
        clearInterval() {}
    });
    return {
        manager,
        changes,
        setStatus(nodeId, status) {
            nodes = nodes.map(node => node.nodeId === nodeId ? { ...node, status } : node);
        }
    };
}

test('选择子服务器后离线会自动回退主服务器', () => {
    const harness = createRouteHarness();
    harness.manager.select('termux-subserver');
    harness.setStatus('termux-subserver', 'offline');

    const snapshot = harness.manager.sync();

    assert.equal(snapshot.activeNodeId, 'main-server');
    assert.equal(snapshot.fallbackNodeId, 'termux-subserver');
    assert.equal(snapshot.reason, 'automatic-fallback');
    assert.equal(snapshot.manualMainOverride, false);
});

test('自动回退的子服务器恢复后会自动切回', () => {
    const harness = createRouteHarness();
    harness.manager.select('termux-subserver');
    harness.setStatus('termux-subserver', 'offline');
    harness.manager.sync();
    harness.setStatus('termux-subserver', 'online');

    const snapshot = harness.manager.sync();

    assert.equal(snapshot.activeNodeId, 'termux-subserver');
    assert.equal(snapshot.fallbackNodeId, null);
    assert.equal(snapshot.reason, 'automatic-recovery');
});

test('用户手动选择主服务器后不自动切回子服务器', () => {
    const harness = createRouteHarness();
    harness.manager.select('termux-subserver');
    harness.setStatus('termux-subserver', 'offline');
    harness.manager.sync();
    harness.manager.select('main-server');
    harness.setStatus('termux-subserver', 'online');

    const snapshot = harness.manager.sync();

    assert.equal(snapshot.activeNodeId, 'main-server');
    assert.equal(snapshot.fallbackNodeId, null);
    assert.equal(snapshot.manualMainOverride, true);
});

test('不能选择离线子服务器', () => {
    const harness = createRouteHarness();
    harness.setStatus('termux-subserver', 'offline');

    assert.throws(
        () => harness.manager.select('termux-subserver'),
        /目标服务器当前离线/
    );
});
