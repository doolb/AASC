'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('llm-server 声明为服务任务并复用通用创建入口', () => {
    const taskSource = read('src/apps/server/modules/task-engine/builtin-tasks/llm-server.js');
    const panelSource = read('src/apps/web-mediacenter/ui/public/js/task-panel.js');

    assert.match(taskSource, /id:\s*'llm-server'/);
    assert.match(taskSource, /mode:\s*'service'/);
    assert.match(
        panelSource,
        /task\.mode\s*===\s*'service'[\s\S]{0,180}this\._viewBuiltinParams\(taskName\)/
    );
    assert.doesNotMatch(
        panelSource,
        /taskName\s*===\s*['"]llm-server['"]/
    );
});
