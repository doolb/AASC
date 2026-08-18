const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const stylesheetPath = path.join(
    __dirname,
    '..',
    'src',
    'apps',
    'web-mediacenter',
    'ui',
    'public',
    'css',
    'upload.css'
);
const sidebarScriptPath = path.join(
    __dirname,
    '..',
    'src',
    'apps',
    'web-mediacenter',
    'ui',
    'public',
    'js',
    'main.js'
);

function readSelectorBlock(stylesheet, selector) {
    const selectorStart = stylesheet.indexOf(`${selector} {`);
    assert.notEqual(selectorStart, -1, `未找到 ${selector} 样式块`);

    const blockStart = selectorStart + selector.length + 2;
    const blockEnd = stylesheet.indexOf('}', blockStart);
    assert.notEqual(blockEnd, -1, `${selector} 样式块缺少结束括号`);

    return stylesheet.slice(blockStart, blockEnd);
}

test('左侧导航入口超出视口时应在导航区域内滚动', () => {
    const stylesheet = fs.readFileSync(stylesheetPath, 'utf8');
    const sidebarNav = readSelectorBlock(stylesheet, '.sidebar-nav');

    assert.match(sidebarNav, /flex\s*:\s*1\s*;/, '导航区域应占用侧栏剩余高度');
    assert.match(sidebarNav, /min-height\s*:\s*0\s*;/, '导航区域应允许 flex 子项收缩');
    assert.match(sidebarNav, /overflow-y\s*:\s*auto\s*;/, '导航区域内容超高时应启用垂直滚动');
    assert.match(sidebarNav, /scrollbar-width\s*:\s*none\s*;/, 'Firefox 导航滚动条应隐藏');
    assert.match(sidebarNav, /-ms-overflow-style\s*:\s*none\s*;/, '旧版 Edge 导航滚动条应隐藏');

    const webkitScrollbar = readSelectorBlock(stylesheet, '.sidebar-nav::-webkit-scrollbar');
    assert.match(webkitScrollbar, /display\s*:\s*none\s*;/, 'WebKit 导航滚动条应隐藏');
    assert.match(sidebarNav, /cursor\s*:\s*grab\s*;/, '导航区域应显示可拖动提示');

    const draggingNav = readSelectorBlock(stylesheet, '.sidebar-nav.is-dragging');
    assert.match(draggingNav, /cursor\s*:\s*grabbing\s*;/, '拖动中导航区域应显示抓取光标');

    const draggingContent = readSelectorBlock(stylesheet, '.content.is-dragging');
    assert.match(draggingContent, /cursor\s*:\s*grabbing\s*;/, '右侧内容拖动时应显示抓取光标');
});

test('左侧导航应支持 Pointer Events 拖动垂直滚动', () => {
    const script = fs.readFileSync(sidebarScriptPath, 'utf8');

    assert.match(script, /pointerdown/, '导航应监听指针按下事件');
    assert.match(script, /pointermove/, '导航应监听指针移动事件');
    assert.match(script, /pointerup/, '导航应监听指针抬起事件');
    assert.match(script, /pointercancel/, '导航应处理指针取消事件');
    assert.match(script, /setPointerCapture/, '拖动开始后应捕获指针');
    assert.match(script, /scrollTop/, '拖动应改变导航区域 scrollTop');

    const pointerDownBlock = script.slice(script.indexOf("addEventListener('pointerdown'"), script.indexOf("addEventListener('pointermove'"));
    assert.doesNotMatch(pointerDownBlock, /setPointerCapture/, '普通点击时不应提前捕获指针');

    const pointerMoveBlock = script.slice(script.indexOf("addEventListener('pointermove'"), script.indexOf("const endDrag"));
    assert.ok(
        pointerMoveBlock.indexOf('dragState.moved = true') < pointerMoveBlock.indexOf('setPointerCapture'),
        '只有确认进入拖动状态后才应捕获指针'
    );
});

test('右侧仅空白内容背景应支持拖动页面滚动', () => {
    const script = fs.readFileSync(sidebarScriptPath, 'utf8');

    assert.match(script, /querySelector\('\.content'\)/, '应获取右侧内容区域');
    assert.match(script, /initContentDragScroll/, '应初始化右侧内容拖动滚动');
    assert.match(script, /window\.scrollY/, '右侧拖动应读取页面纵向滚动位置');
    assert.match(script, /window\.scrollTo/, '右侧拖动应更新页面纵向滚动位置');
    assert.match(script, /event\.target\s*!==\s*content/, '只有 content 空白背景才应启动拖动');
});
