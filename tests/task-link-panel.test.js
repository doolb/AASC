'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const panel = fs.readFileSync(
  path.join(__dirname, '../src/apps/web-mediacenter/ui/public/js/task-panel.js'),
  'utf8'
);
const taskHandler = fs.readFileSync(
  path.join(__dirname, '../src/apps/server/modules/task-engine/web-socket-handler.js'),
  'utf8'
);

test('任务面板接收并保存服务端返回的任务链接', () => {
  assert.match(panel, /taskLinks:\s*\[\]/u);
  assert.match(panel, /payload\.links/u);
});

test('链接弹窗展示已链接目标和目标显示端，并支持解除', () => {
  assert.match(panel, /已链接/u);
  assert.match(panel, /targetDisplayId/u);
  assert.match(panel, /task-link-linked-item[^>]*data-instanceid/u);
  assert.match(panel, /task:unlink/u);
  assert.match(panel, /task-link-remove-btn/u);
  assert.match(panel, /taskLinkCandidateList/u);
  assert.match(panel, /appendChild\(item\)/u);
});

test('链接弹窗排除已链接目标并处理链接变更刷新', () => {
  assert.match(panel, /taskLinks.*sourceInstanceId|sourceInstanceId.*taskLinks/su);
  assert.match(panel, /task:linked/u);
  assert.match(panel, /task:unlinked/u);
  assert.match(panel, /_requestTaskList\(\)/u);
});

test('选择目标后保持链接弹窗打开', () => {
  const start = panel.indexOf('const bindSelectButton');
  const end = panel.indexOf('overlay.querySelectorAll', start);
  const selectHandler = panel.slice(start, end);
  assert.doesNotMatch(selectHandler, /closeOverlay\(\)/u);
  assert.match(selectHandler, /taskLinkLinkedList/u);
  assert.match(selectHandler, /appendChild\(item\)/u);
});

test('服务端拒绝缺少目标实例 ID 的解除请求', () => {
  assert.match(taskHandler, /task:unlink[\s\S]*!payload\.targetInstance/u);
});
