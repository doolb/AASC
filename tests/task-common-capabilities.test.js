'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const TaskManager = require('../src/apps/server/modules/task-engine/task-manager.js');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('用户任务列表透传控制端展示元数据和侧边栏清单', () => {
  const source = read('src/apps/server/modules/task-engine/web-socket-handler.js');

  assert.match(source, /let sidebar = null/);
  assert.match(source, /let sidebarManifest = null/);
  assert.match(source, /let configButton = null/);
  assert.match(source, /if \(mod\.sidebar\) sidebar = mod\.sidebar/);
  assert.match(source, /if \(mod\.sidebarManifest\) sidebarManifest = mod\.sidebarManifest/);
  assert.match(source, /if \(mod\.configButton\) configButton = mod\.configButton/);
  assert.match(source, /if \(mod\.control\) control = mod\.control/);
  assert.match(source, /sidebar, sidebarManifest, widget, configButton, control/);
});

test('任务列表合并同名任务时保留侧边栏展示元数据', () => {
  const source = read('src/apps/web-mediacenter/ui/public/js/task-panel.js');

  assert.match(source, /if \(task\.sidebar && !merged\[key\]\.sidebar\) merged\[key\]\.sidebar = task\.sidebar/);
  assert.match(source, /SidebarRegistry\.registerManifest/);
  assert.match(source, /_renderTaskControlButtons/);
});

test('内置任务和用户任务共用 control.actions 页面描述', () => {
  const registrySource = read('src/apps/server/modules/task-engine/builtin-tasks/registry.js');
  const handlerSource = read('src/apps/server/modules/task-engine/web-socket-handler.js');
  const llmSource = read('src/apps/server/modules/task-engine/builtin-tasks/llm-server.js');
  const panelSource = read('src/apps/web-mediacenter/ui/public/js/task-panel.js');

  assert.match(registrySource, /control:\s*t\.control \|\| null/);
  assert.match(handlerSource, /control: t\.control \|\| null/);
  assert.match(llmSource, /control:\s*\{[\s\S]*defaultModelMappings/);
  assert.match(llmSource, /api\.onMessage/);
  assert.match(panelSource, /control\.actions/);
  assert.match(panelSource, /_openTaskControl/);
  assert.doesNotMatch(panelSource, /task\.configButton && task\.configButton\.id === ['"]defaultModelMappings['"]/);
});

test('用户服务上下文提供与内置服务一致的 Widget 生命周期能力', () => {
  const source = read('src/apps/server/modules/task-engine/task-manager.js');

  assert.match(source, /const actionHandlers = new Map\(\);[\s\S]{0,260}this\._widgetActions\.set\(instanceId, actionHandlers\)/);
  assert.match(source, /serviceContext = \{[\s\S]{0,900}postWidgetUpdate:/);
  assert.match(source, /serviceContext = \{[\s\S]{0,1100}onWidgetAction:/);
  assert.match(source, /serviceContext = \{[\s\S]{0,1300}taskName: task\.taskName/);
  assert.match(source, /服务启动失败后不保留已注册的控制端动作/);
});

test('用户服务按实例接收 Widget 动作并推送状态', async (t) => {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-common-capabilities-'));
  t.after(() => fs.rmSync(tasksDir, { recursive: true, force: true }));

  const taskName = 'user-service-ui';
  const taskDir = path.join(tasksDir, taskName);
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(taskDir, 'service.js'), `module.exports = {
    async run(context) {
      context.postWidgetUpdate({ online: true });
      context.onWidgetAction('ping', async (params) => ({ success: true, data: params }));
      return { stop: async () => {} };
    }
  };`);

  const manager = new TaskManager({ tasksDir });
  await manager.init();
  t.after(() => manager.destroy());

  const widgetUpdates = [];
  manager.on('widgetUpdate', (instanceId, data) => widgetUpdates.push({ instanceId, data }));
  const submitted = await manager.submit({
    taskName,
    taskType: 'user',
    entryFile: 'service.js',
    target: 'server',
    mode: 'service',
    files: []
  });
  await manager.runInstance(taskName, submitted.instanceId);
  await new Promise((resolve) => setTimeout(resolve, 20));

  const actionResult = await manager.handleWidgetAction(submitted.instanceId, 'ping', { value: 7 });

  assert.deepEqual(actionResult, { success: true, data: { value: 7 } });
  assert.deepEqual(widgetUpdates, [{ instanceId: submitted.instanceId, data: { online: true } }]);
  await manager.stopInstance(taskName, submitted.instanceId);
  assert.deepEqual(await manager.handleWidgetAction(submitted.instanceId, 'ping', {}), {
    success: false,
    error: '未知动作: ping'
  });
});

test('AI 任务规则说明用户任务可以自管理控制端资源且复用 URL 路由', () => {
  const design = read('docs/design/ai-rules.md');
  const spec = read('docs/spec/remote-task-system.md');

  assert.match(design, /用户任务是由项目维护者自行管理的代码隔离单元/);
  assert.match(design, /context\.registerRoute\(\)/);
  assert.match(spec, /用户任务可以自主管理控制端页面资源/);
  assert.match(spec, /widget\.script/);
});
