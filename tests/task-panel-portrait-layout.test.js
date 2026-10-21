'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('../node_modules/puppeteer');

const PUBLIC = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const readPublic = relativePath => fs.readFileSync(path.join(PUBLIC, relativePath), 'utf8');
let browser;

before(async () => {
    browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
        headless: true,
        timeout: 20000,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--disable-gpu']
    });
});

after(async () => {
    if (!browser) return;
    const closed = await Promise.race([
        browser.close().then(() => true).catch(() => true),
        new Promise(resolve => setTimeout(() => resolve(false), 5000))
    ]);
    if (!closed) browser.process()?.kill();
});

async function renderTaskPanel(viewport = { width: 360, height: 800 }) {
    const page = await browser.newPage();
    await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
        <body><main id="panel-task"><div id="taskTabList" class="task-tab-content active"></div></main>
        <button id="outside">面板外</button></body></html>`);
    await page.addStyleTag({ content: `${readPublic('css/upload.css')}
        html, body { display: block; width: 100%; height: 100%; margin: 0; }
        #panel-task { display: block; width: 100%; height: 100%; padding: 0; }
        #taskTabList { height: 100%; }` });
    await page.addScriptTag({ path: path.join(PUBLIC, 'js/task-panel.js') });
    await page.addScriptTag({ path: path.join(PUBLIC, 'js/self-test.js') });
    await page.evaluate(() => {
        const panel = window.TaskPanel;
        panel._initDone = true;
        window.testMessages = [];
        panel._send = message => { window.testMessages.push(message); return true; };
        // 使用完整卡片与真实实例/结果渲染，只拦截会执行任务或打开其他业务页面的动作。
        window.testActions = [];
        for (const action of ['_createBuiltinInstance', '_viewBuiltinParams', '_showGlobalConfig',
            '_createUserInstance', '_viewEdit', '_confirmDelete', '_openTaskControl', '_switchToNew']) {
            panel[action] = (...args) => window.testActions.push({ action, args });
        }
        panel.taskList = [
            {
                taskName: 'builtin.demo', name: '内置任务', taskType: 'builtin', params: [{ name: 'demo' }],
                instances: [{ instanceId: 'builtin-run', status: 'running', progress: 37, timestamp: 10 }],
                control: { actions: [{ id: 'settings', placement: 'task', label: '专属设置' }] }
            },
            ...Array.from({ length: 12 }, (_, index) => ({
                taskName: `user.${index}`, name: `User task ${index}`, taskType: 'user',
                instances: index === 2 ? [
                    { instanceId: 'old-run', status: 'completed', timestamp: 10 },
                    { instanceId: 'new-run', status: 'completed', timestamp: 20 }
                ] : []
            })),
            { taskName: 'long', name: 'LongTask'.repeat(35) + '<img src=x onerror="window.bad=true">', taskType: 'user' }
        ];
        panel._renderTaskList();
    });
    return page;
}

async function closePage(page) {
    const closed = await Promise.race([
        page.close().then(() => true).catch(() => true),
        new Promise(resolve => setTimeout(() => resolve(false), 3000))
    ]);
    if (!closed) page.browser().process()?.kill();
}

async function assertLayout(page, portrait) {
    const result = await page.evaluate(async () => {
        const rail = document.querySelector('.task-list-rail');
        const columns = [...document.querySelector('.task-three-col').children].map(element => {
            const rect = element.getBoundingClientRect();
            return { left: rect.left, right: rect.right, width: rect.width };
        });
        return {
            direction: getComputedStyle(document.querySelector('.task-three-col')).flexDirection,
            overflowX: getComputedStyle(rail).overflowX, overflowY: getComputedStyle(rail).overflowY,
            railDisplay: getComputedStyle(rail).display,
            hasToggle: Boolean(document.getElementById('taskPickerToggle')),
            hasPickerContent: Boolean(document.getElementById('taskPickerContent')),
            railWidth: rail.clientWidth, railScrollWidth: rail.scrollWidth,
            railHeight: rail.clientHeight, railScrollHeight: rail.scrollHeight,
            columns, documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
            selfTest: await window.SelfTest.tests.find(item => item.id === 'task_panel_portrait_layout').run()
        };
    });
    assert.equal(result.direction, portrait ? 'column' : 'row');
    if (portrait) {
        assert.equal(result.overflowX, 'hidden');
        assert.equal(result.overflowY, 'auto');
        assert.ok(result.railScrollHeight > result.railHeight, '展开后的卡片列表应可纵向滚动');
        assert.ok(result.railScrollWidth <= result.railWidth + 1, '长任务名称不得撑宽列表');
    } else {
        assert.equal(result.railDisplay, 'contents');
        assert.equal(result.hasToggle, false);
        assert.equal(result.hasPickerContent, false);
    }
    for (const column of result.columns) {
        assert.ok(column.width > 0);
        assert.ok(column.left >= -1 && column.right <= result.viewportWidth + 1, JSON.stringify(column));
    }
    assert.ok(result.documentWidth <= result.viewportWidth, JSON.stringify(result));
    assert.equal(result.selfTest.success, true, JSON.stringify(result.selfTest));
    return result;
}

test('竖屏下拉纵向滚动，选择后收起为相同完整卡片，实例和结果不越界', { timeout: 30000 }, async () => {
    const page = await renderTaskPanel();
    try {
        assert.equal(await page.$eval('#taskPickerContent', el => el.hidden), true);
        assert.match(await page.$eval('.task-picker-current', el => el.textContent), /请选择任务/);
        await page.click('#taskPickerToggle');
        await assertLayout(page, true);
        await page.click('.task-list-rail .task-card-select');
        const result = await page.evaluate(() => ({
            hidden: document.getElementById('taskPickerContent').hidden,
            expanded: document.getElementById('taskPickerToggle').getAttribute('aria-expanded'),
            current: document.querySelector('.task-picker-current > .task-card').innerHTML,
            listCard: document.querySelector('.task-list-rail .task-card').innerHTML,
            progress: document.querySelector('.task-picker-current .task-card-progress-fill').style.width,
            buttons: [...document.querySelectorAll('.task-picker-current .task-card-actions button')].map(el => el.textContent),
            task: window.TaskPanel._selectedTaskName, instance: window.TaskPanel._selectedInstanceId,
            resultText: document.getElementById('taskResultCol').textContent
        }));
        assert.equal(result.hidden, true);
        assert.equal(result.expanded, 'false');
        assert.equal(result.current, result.listCard);
        assert.equal(result.progress, '37%');
        assert.deepEqual(result.buttons, ['创建实例', '配置', '全局配置', '专属设置']);
        assert.equal(result.task, 'builtin.demo');
        assert.equal(result.instance, 'builtin-run');
        assert.match(result.resultText, /停止/);
        assert.equal(await page.evaluate(() => Boolean(window.bad || document.querySelector('.task-picker img'))), false);
        assert.equal(await page.evaluate(async () => (await window.SelfTest.tests.find(item => item.id === 'task_panel_portrait_layout').run()).success), true);
        await page.screenshot({ path: '/tmp/aasc-task-picker-collapsed.png' });
        await page.click('#taskPickerToggle');
        await page.screenshot({ path: '/tmp/aasc-task-picker-expanded.png' });
    } finally {
        await closePage(page);
    }
});

test('收起和展开的卡片操作按钮均保持独立，新建入口始终可用', { timeout: 30000 }, async () => {
    const page = await renderTaskPanel();
    try {
        await page.evaluate(() => window.TaskPanel._selectTask('builtin.demo'));
        for (const selector of ['.task-picker-current', '.task-list-rail']) {
            if (selector.includes('rail')) await page.click('#taskPickerToggle');
            const buttons = await page.$$(`${selector} .builtin .task-card-actions button`);
            for (const button of buttons) await button.click();
            assert.equal(await page.$eval('#taskPickerContent', el => el.hidden), !selector.includes('rail'));
        }
        await page.type('#taskSearch', 'User task 2');
        const userButtons = await page.$$('.task-list-rail .task-card:not([hidden]) .task-card-actions button');
        for (const button of userButtons) await button.click();
        assert.equal(await page.evaluate(() => window.TaskPanel._selectedTaskName), 'builtin.demo');
        assert.equal(await page.$eval('#taskPickerContent', el => el.hidden), false);
        assert.deepEqual(await page.evaluate(() => window.testActions.map(item => item.action)), [
            '_createBuiltinInstance', '_viewBuiltinParams', '_showGlobalConfig', '_openTaskControl',
            '_createBuiltinInstance', '_viewBuiltinParams', '_showGlobalConfig', '_openTaskControl',
            '_createUserInstance', '_viewEdit', '_confirmDelete'
        ]);
        await page.click('.task-list-col-header button');
        assert.equal(await page.evaluate(() => window.testActions.at(-1).action), '_switchToNew');
    } finally {
        await closePage(page);
    }
});

test('搜索仅过滤下拉卡片，无匹配提示且轮询恢复搜索焦点和光标', { timeout: 30000 }, async () => {
    const page = await renderTaskPanel();
    try {
        await page.evaluate(() => window.TaskPanel._selectTask('builtin.demo'));
        await page.click('#taskPickerToggle');
        await page.type('#taskSearch', 'User task 2');
        await page.evaluate(() => {
            const input = document.getElementById('taskSearch');
            input.setSelectionRange(2, 5);
            window.TaskPanel.taskList[0].instances[0].progress = 64;
            window.TaskPanel._handleTaskList({ tasks: window.TaskPanel.taskList });
        });
        const result = await page.evaluate(() => ({
            query: document.getElementById('taskSearch').value,
            focused: document.activeElement.id,
            selection: [document.activeElement.selectionStart, document.activeElement.selectionEnd],
            open: !document.getElementById('taskPickerContent').hidden,
            visible: [...document.querySelectorAll('.task-list-rail .task-card:not([hidden]) .task-card-select')].map(el => el.textContent),
            groupHidden: document.querySelector('.task-list-group').hidden,
            currentVisible: getComputedStyle(document.querySelector('.task-picker-current > .task-card')).display !== 'none',
            progress: document.querySelector('.task-picker-current .task-card-progress-fill').style.width
        }));
        assert.equal(result.query, 'User task 2');
        assert.equal(result.focused, 'taskSearch');
        assert.deepEqual(result.selection, [2, 5]);
        assert.equal(result.open, true);
        assert.deepEqual(result.visible, ['User task 2']);
        assert.equal(result.groupHidden, true);
        assert.equal(result.currentVisible, true);
        assert.equal(result.progress, '64%');
        await page.$eval('#taskSearch', el => { el.value = '不存在'; el.dispatchEvent(new Event('input', { bubbles: true })); });
        assert.equal(await page.$eval('.task-picker-empty', el => el.hidden), false);
        await page.$eval('#taskSearch', el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
        assert.equal(await page.$eval('.task-picker-empty', el => el.hidden), true);
        assert.equal(await page.$eval('.task-list-group', el => el.hidden), false);
    } finally {
        await closePage(page);
    }
});

test('轮询保留列表滚动位置，外部点击与 Escape 收起，监听不重复绑定', { timeout: 30000 }, async () => {
    const page = await renderTaskPanel();
    try {
        await page.click('#taskPickerToggle');
        const positions = await page.evaluate(() => {
            document.querySelector('.task-list-rail').scrollTop = 245;
            const before = document.querySelector('.task-list-rail').scrollTop;
            for (let count = 0; count < 5; count++) window.TaskPanel._handleTaskList({ tasks: window.TaskPanel.taskList });
            return [before, document.querySelector('.task-list-rail').scrollTop];
        });
        assert.ok(positions[0] > 0);
        assert.equal(positions[1], positions[0]);
        await page.keyboard.press('Escape');
        assert.equal(await page.$eval('#taskPickerContent', el => el.hidden), true);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'taskPickerToggle');
        await page.keyboard.press('Enter');
        assert.equal(await page.$eval('#taskPickerContent', el => el.hidden), false);
        assert.equal(await page.$eval('.task-list-rail', el => el.scrollTop), positions[0]);
        await page.evaluate(() => {
            window.closeCalls = 0;
            const original = window.TaskPanel._setTaskPickerOpen;
            window.TaskPanel._setTaskPickerOpen = function(...args) {
                if (args[0] === false) window.closeCalls++;
                return original.apply(this, args);
            };
        });
        await page.click('#outside');
        assert.equal(await page.$eval('#taskPickerContent', el => el.hidden), true);
        assert.equal(await page.evaluate(() => window.closeCalls), 1);
    } finally {
        await closePage(page);
    }
});

test('键盘选择任务及最近实例，再次选择同一任务也收起', { timeout: 30000 }, async () => {
    const page = await renderTaskPanel();
    try {
        await page.focus('#taskPickerToggle');
        await page.keyboard.press('Enter');
        await page.type('#taskSearch', 'User task 2');
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.className), 'task-card-select');
        await page.keyboard.press('Enter');
        assert.deepEqual(await page.evaluate(() => [window.TaskPanel._selectedTaskName, window.TaskPanel._selectedInstanceId]), ['user.2', 'new-run']);
        assert.equal(await page.$eval('#taskPickerContent', el => el.hidden), true);
        await page.keyboard.press('Enter');
        await page.click('.task-list-rail .task-card:not([hidden]) .task-card-select');
        assert.equal(await page.$eval('#taskPickerContent', el => el.hidden), true);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'taskPickerToggle');
    } finally {
        await closePage(page);
    }
});

test('权威列表删除当前任务时清理任务和实例，空任务列表仍可展开与新建', { timeout: 30000 }, async () => {
    const page = await renderTaskPanel();
    try {
        await page.evaluate(() => {
            window.TaskPanel._selectTask('user.2');
            window.TaskPanel._handleTaskList({ tasks: [] });
        });
        assert.deepEqual(await page.evaluate(() => [window.TaskPanel._selectedTaskName, window.TaskPanel._selectedInstanceId]), [null, null]);
        assert.match(await page.$eval('.task-picker-current', el => el.textContent), /请选择任务/);
        assert.match(await page.$eval('#taskInstancesCol', el => el.textContent), /选择一个任务/);
        await page.click('#taskPickerToggle');
        assert.equal(await page.$eval('#taskPickerContent', el => el.hidden), false);
        assert.match(await page.$eval('.task-list-rail', el => el.textContent), /还没有用户任务/);
        await page.click('.task-list-col-header button');
        assert.equal(await page.evaluate(() => window.testActions.at(-1).action), '_switchToNew');
    } finally {
        await closePage(page);
    }
});

test('横屏保留原搜索栏、常驻卡片和三列，方向切换只在竖屏使用下拉', { timeout: 30000 }, async () => {
    const page = await renderTaskPanel({ width: 1280, height: 720 });
    try {
        const result = await assertLayout(page, false);
        assert.equal(result.columns[0].width, 240);
        assert.equal(result.columns[1].width, 200);
        assert.ok(result.columns[2].left > 440);
        assert.equal(await page.$eval('.task-list-col-header #taskSearch', el => Boolean(el)), true);
        assert.equal(await page.$('.task-picker'), null);
        assert.equal(await page.$('.task-card-select'), null);
        assert.equal(await page.$$eval('.task-list-rail .task-card', cards => cards.filter(card => getComputedStyle(card).display !== 'none').length), 14);
        await page.type('#taskSearch', 'User task 2');
        assert.equal(await page.$$eval('.task-list-rail .task-card', cards => cards.filter(card => getComputedStyle(card).display !== 'none').length), 1);
        await page.click('.task-list-rail .task-card:not([hidden]) .task-card-title');
        await page.evaluate(() => window.TaskPanel._handleTaskList({ tasks: window.TaskPanel.taskList }));
        assert.equal(await page.evaluate(() => window.TaskPanel._selectedTaskName), 'user.2');
        await page.addStyleTag({ content: readPublic('css/theme.css') });
        await page.evaluate(() => document.documentElement.dataset.themeMode = 'light');
        await page.setViewport({ width: 320, height: 640 });
        await page.waitForSelector('#taskPickerToggle');
        assert.equal(await page.$eval('#taskSearch', el => el.value), 'User task 2');
        assert.equal(await page.$eval('#taskPickerContent', el => el.hidden), true);
        assert.match(await page.$eval('.task-picker-current .task-card-title', el => el.textContent), /User task 2/);
        await page.click('#taskPickerToggle');
        await page.$eval('#taskSearch', el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
        await assertLayout(page, true);
        const portraitScroll = await page.$eval('.task-list-rail', el => { el.scrollTop = 180; return el.scrollTop; });
        await page.setViewport({ width: 1280, height: 720 });
        await page.waitForFunction(() => !document.getElementById('taskPickerToggle'));
        await assertLayout(page, false);
        assert.equal(await page.$eval('#taskSearch', el => el.value), '');
        await page.setViewport({ width: 320, height: 640 });
        await page.waitForSelector('#taskPickerToggle');
        assert.equal(await page.$eval('#taskPickerContent', el => el.hidden), false);
        assert.equal(await page.$eval('.task-list-rail', el => el.scrollTop), portraitScroll);
        await assertLayout(page, true);
    } finally {
        await closePage(page);
    }
});

test('手机触控可展开、选择和操作收起卡片', { timeout: 30000 }, async () => {
    const page = await renderTaskPanel({ width: 360, height: 800, isMobile: true, hasTouch: true });
    try {
        await page.tap('#taskPickerToggle');
        await assertLayout(page, true);
        await page.tap('.task-list-rail .task-card-select');
        assert.equal(await page.$eval('#taskPickerContent', el => el.hidden), true);
        await page.tap('.task-picker-current .task-card-actions button');
        assert.deepEqual(await page.evaluate(() => window.testActions.at(-1)), {
            action: '_createBuiltinInstance', args: ['builtin.demo']
        });
        assert.equal(await page.$eval('#taskPickerContent', el => el.hidden), true);
        await page.tap('#taskPickerToggle');
        await page.tap('#taskPickerToggle');
        assert.equal(await page.$eval('#taskPickerContent', el => el.hidden), true);
    } finally {
        await closePage(page);
    }
});
