const assert = require('assert/strict');
const test = require('node:test');

const {
  createAndroidControlPageAccess,
} = require('../src/apps/server/modules/display/android-control-page-access');

test('只有声明 Android 控制端能力的显示端可以被开放控制端', () => {
  const sent = [];
  const saved = [];
  const display = { displayId: 'display-1', state: { capabilities: { androidControlPage: true }, androidControlPageOpen: false } };
  const access = createAndroidControlPageAccess({
    sendToDisplay: (id, message) => sent.push({ id, message }),
    persist: (target, patch) => saved.push({ target, patch }),
  });

  const result = access.set(display, true);

  assert.equal(result.enabled, true);
  assert.deepEqual(sent, [{ id: 'display-1', message: { type: 'displayControlAccess', enabled: true } }]);
  assert.deepEqual(saved[0].patch, { androidControlPageOpen: true });
});

test('旧显示端或未声明能力时拒绝开放控制端', () => {
  const display = { displayId: 'display-1', state: { capabilities: {} } };
  const access = createAndroidControlPageAccess();

  assert.throws(() => access.set(display, true), /不支持 Android 控制端/);
});
