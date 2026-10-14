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
    const closePromise = browser.close().catch(() => {});
    const closed = await Promise.race([
        closePromise.then(() => true),
        new Promise(resolve => setTimeout(() => resolve(false), 5000))
    ]);
    if (!closed) browser.process()?.kill();
});

async function renderTaskPanel(viewport) {
    const page = await browser.newPage();
    await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
        <body><main id="panel-task"><div id="taskTabList" class="task-tab-content active"></div></main></body></html>`);
    await page.addStyleTag({ content: `${readPublic('css/upload.css')}
        html, body { width: 100%; height: 100%; margin: 0; }
        #panel-task { display: block; width: 100%; height: 100%; padding: 0; }
        #taskTabList { height: 100%; }` });
    await page.addScriptTag({ path: path.join(PUBLIC, 'js/task-panel.js') });
    await page.evaluate(() => {
        window.TaskPanel._initDone = true;
        window.TaskPanel.taskList = [
            { name: 'Builtin task', taskType: 'builtin' },
            ...Array.from({ length: 6 }, (_, index) => ({ name: `User task ${index}`, taskType: 'user' }))
        ];
        window.TaskPanel._taskCardHTML = task => (
            `<article class="task-card ${task.taskType}"><span class="task-card-title">${task.name}</span></article>`
        );
        window.TaskPanel._renderTaskList();
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

test('竖屏任务卡片横向滚动，实例和结果列全宽堆叠且不撑出视口', { timeout: 30000 }, async () => {
    const page = await renderTaskPanel({ width: 360, height: 800 });
    try {
        const result = await page.evaluate(() => {
            const layout = document.querySelector('.task-three-col');
            const rail = document.querySelector('.task-list-rail');
            const columns = ['.task-instances-col', '.task-result-col'].map(selector => {
                const element = document.querySelector(selector);
                const rect = element.getBoundingClientRect();
                return { left: rect.left, right: rect.right, width: rect.width };
            });
            return {
                direction: getComputedStyle(layout).flexDirection,
                overflowX: getComputedStyle(rail).overflowX,
                railWidth: rail.clientWidth,
                railScrollWidth: rail.scrollWidth,
                columns,
                documentWidth: document.documentElement.scrollWidth,
                viewportWidth: window.innerWidth
            };
        });

        assert.equal(result.direction, 'column');
        assert.equal(result.overflowX, 'auto');
        assert.ok(result.railScrollWidth > result.railWidth, '多张任务卡片应能横向滚动');
        for (const column of result.columns) {
            assert.ok(column.width > 0);
            assert.ok(column.left >= -1 && column.right <= result.viewportWidth + 1,
                `任务面板列不能越界：${JSON.stringify(column)}`);
        }
        assert.ok(result.documentWidth <= result.viewportWidth,
            `横向滚动应由任务条内部承载：${JSON.stringify(result)}`);

        const filtering = await page.evaluate(() => {
            const search = document.getElementById('taskSearch');
            search.value = 'User task 2';
            window.TaskPanel._filterTasks();
            return [...document.querySelectorAll('.task-card')].map(card => getComputedStyle(card).display);
        });
        assert.equal(filtering.filter(display => display !== 'none').length, 1,
            '任务卡片分组后仍应支持既有搜索过滤');
    } finally {
        await closePage(page);
    }
});

test('横屏任务面板仍使用三列布局', { timeout: 30000 }, async () => {
    const page = await renderTaskPanel({ width: 1280, height: 720 });
    try {
        const result = await page.evaluate(() => {
            const layout = document.querySelector('.task-three-col');
            return {
                direction: getComputedStyle(layout).flexDirection,
                listWidth: document.querySelector('.task-list-col').getBoundingClientRect().width,
                instancesWidth: document.querySelector('.task-instances-col').getBoundingClientRect().width,
                resultLeft: document.querySelector('.task-result-col').getBoundingClientRect().left,
                documentWidth: document.documentElement.scrollWidth
            };
        });
        assert.equal(result.direction, 'row');
        assert.equal(result.listWidth, 240);
        assert.equal(result.instancesWidth, 200);
        assert.ok(result.resultLeft > result.listWidth + result.instancesWidth);
        assert.ok(result.documentWidth <= 1280);
    } finally {
        await closePage(page);
    }
});
