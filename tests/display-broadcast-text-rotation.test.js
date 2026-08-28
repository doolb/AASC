'use strict';

// 显示端播报文字回归测试：#voiceTextDisplay 同时承载 TTS 与 ASR 文本，
// 因此直接检查旋转分支和 CSS 规则，避免只修复其中一种文字来源。
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('../node_modules/express');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('../node_modules/puppeteer');
const { once } = require('node:events');

const PUBLIC = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');

const DISPLAY_HTML = fs.readFileSync(
    path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/display.html'),
    'utf8'
);
const DISPLAY_CSS = fs.readFileSync(
    path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/css/display.css'),
    'utf8'
);

let server;
let browser;

before(async () => {
    const app = express();
    app.use(express.static(PUBLIC));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--disable-gpu']
    });
});

after(async () => {
    if (browser) await browser.close();
    if (server) server.close();
});

function getRotationBranch(rotation) {
    const branchPattern = rotation === 0
        ? /if \(currentRotation === 0\) \{([\s\S]*?)\n            \} else if \(currentRotation === 90\)/u
        : new RegExp(
            `else if \\(currentRotation === ${rotation}\\) \\{([\\s\\S]*?)(?=\\n            \\} else if|\\n            \\})`,
            'u'
        );
    const match = DISPLAY_HTML.match(branchPattern);
    assert.ok(match, `未找到 ${rotation}° 旋转分支`);
    return match[1];
}

test('TTS 播报文本与语音识别文本共用旋转适配节点', () => {
    assert.match(DISPLAY_HTML, /function showTtsText\(text\)[\s\S]*voiceTextDisplay\.className = 'voice-text-visible'/u);
    assert.match(DISPLAY_HTML, /function updateVoiceTextDisplay\(text, isFinal\)[\s\S]*voiceTextDisplay\.className = 'voice-text-visible'/u);
});

test('播报文本整体跟随90°/180°/270°旋转且不使用竖排字形', () => {
    const rotation90 = getRotationBranch(90);
    const rotation180 = getRotationBranch(180);
    const rotation270 = getRotationBranch(270);
    const textElementNames = [
        'connectionStatus',
        'timeDisplay',
        'fileNameDisplay',
        'voiceStatus',
        'voiceTextDisplay'
    ];

    for (const [branch, angle] of [[rotation90, 90], [rotation180, 180], [rotation270, 270]]) {
        for (const elementName of textElementNames) {
            assert.match(branch, new RegExp(`${elementName}\\.style\\.transform = 'rotate\\(${angle}deg\\)'`, 'u'));
            assert.doesNotMatch(branch, new RegExp(`${elementName}\\.style\\.writingMode = 'vertical-rl'`, 'u'));
            assert.doesNotMatch(branch, new RegExp(`${elementName}\\.style\\.textOrientation = 'mixed'`, 'u'));
        }
    }
});

test('播报文本字号按约定放大50%', () => {
    assert.match(
        DISPLAY_CSS,
        /\n\s*#voiceTextDisplay\s*\{\s*position: fixed;\s*font-size:\s*36px/u,
        '未找到播报文本桌面端 36px 样式'
    );
    assert.match(
        DISPLAY_CSS,
        /@media \(max-width: 768px\)[\s\S]*?#voiceTextDisplay\s*\{\s*font-size:\s*27px/u,
        '未找到播报文本移动端 27px 样式'
    );
    assert.doesNotMatch(DISPLAY_CSS, /@keyframes voice-pulse\s*\{[^}]*transform:\s*scale/u);
    assert.doesNotMatch(DISPLAY_CSS, /@keyframes voice-text-fade-in\s*\{[^}]*transform:/u);
});

test('媒体名字号按约定放大一倍', () => {
    assert.match(
        DISPLAY_CSS,
        /\n\s*#fileNameDisplay\s*\{[\s\S]*?font-size:\s*48px/u,
        '未找到媒体名桌面端 48px 样式'
    );
    assert.match(
        DISPLAY_CSS,
        /@media \(max-width: 768px\)[\s\S]*?#fileNameDisplay\s*\{[\s\S]*?font-size:\s*32px/u,
        '未找到媒体名移动端 32px 样式'
    );
});

test('90°和270°旋转使用交换后的逻辑画布重新适配文本位置', () => {
    assert.match(
        DISPLAY_HTML,
        /function getRotationLayout\(\)[\s\S]*?layoutWidth = isQuarterTurn \? viewportHeight : viewportWidth[\s\S]*?layoutHeight = isQuarterTurn \? viewportWidth : viewportHeight/u,
        '旋转布局必须在四分之一转时交换宽高'
    );
    assert.match(
        DISPLAY_HTML,
        /function applyRotationTextLayout\(layout\)[\s\S]*?layout\.layoutWidth[\s\S]*?layout\.layoutHeight/u,
        '文本位置适配必须使用旋转后的逻辑画布尺寸'
    );
    assert.match(DISPLAY_HTML, /const rotationLayout = getRotationLayout\(\);/u);
    assert.match(DISPLAY_HTML, /const edgeOffset = `\$\{rotationLayout\.margin\}px`/u);
    assert.match(DISPLAY_HTML, /const maxWidth = Math\.max\(layout\.layoutWidth[\s\S]*const maxHeight = Math\.max\(layout\.layoutHeight/u);
    assert.match(DISPLAY_HTML, /applyRotationTextLayout\(rotationLayout\);/u);
    assert.match(DISPLAY_HTML, /attributeFilter: \['class'\]/u);
    assert.match(DISPLAY_HTML, /window\.addEventListener\('resize',[\s\S]*?applyRotation\(\);/u);
});

test('天气响应等动态弹窗应随显示端旋转并使用逻辑画布限制尺寸', () => {
    assert.match(DISPLAY_HTML, /data\.action === 'weatherResult'[\s\S]*showVoiceResponsePopup\(data\.text\)/u);
    assert.match(
        DISPLAY_HTML,
        /function getRotationPopupElements\(\)[\s\S]*voice-response-popup[\s\S]*voice-confirm-popup[\s\S]*reminder-popup/u,
        '旋转布局必须包含天气响应及同类动态弹窗'
    );
    assert.match(
        DISPLAY_HTML,
        /function applyRotationPopupLayout\(layout\)[\s\S]*layout\.layoutWidth[\s\S]*layout\.layoutHeight[\s\S]*currentRotation/u,
        '动态弹窗必须按旋转后的逻辑宽高和当前角度布局'
    );
    assert.match(
        DISPLAY_HTML,
        /document\.body\.appendChild\(popup\);[\s\S]*applyRotationPopupLayout\(getRotationLayout\(\)\)/u,
        '动态弹窗创建后必须立即应用当前旋转'
    );
    assert.match(DISPLAY_CSS, /--popup-rotation/u);
    assert.match(DISPLAY_CSS, /popupPulse[\s\S]*var\(--popup-rotation\)/u);
});

test('实际旋转后的长中文固定文本包围盒保持在视口内', async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800 });
    await page.goto(`http://127.0.0.1:${server.address().port}/display.html?displayId=rotation-boundary-test`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000
    });
    await page.waitForFunction(() => typeof window.handleControl === 'function', { timeout: 10000 });

    const boxes = await page.evaluate(() => {
        const longText = '连接状态和媒体名称包含中文，旋转后不能越界。'.repeat(8);
        const connection = document.getElementById('connectionStatus');
        const fileName = document.getElementById('fileNameDisplay');
        const voiceText = document.getElementById('voiceTextDisplay');
        connection.textContent = longText;
        connection.className = 'connected';
        fileName.textContent = longText;
        fileName.style.display = 'block';
        voiceText.textContent = longText;
        voiceText.className = 'voice-text-visible';
        handleControl({ action: 'rotate', value: 90 });
        return new Promise((resolve) => {
            const waitForFrames = (count) => {
                if (count === 0) {
                    resolve([connection, fileName, voiceText].map((element) => {
                        const rect = element.getBoundingClientRect();
                        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
                    }));
                    return;
                }
                requestAnimationFrame(() => waitForFrames(count - 1));
            };
            waitForFrames(5);
        });
    });

    for (const box of boxes) {
        assert.ok(box.left >= 19, `文本左边界越界: ${JSON.stringify(box)}`);
        assert.ok(box.right <= 1181, `文本右边界越界: ${JSON.stringify(box)}`);
        assert.ok(box.top >= 19, `文本上边界越界: ${JSON.stringify(box)}`);
        assert.ok(box.bottom <= 781, `文本下边界越界: ${JSON.stringify(box)}`);
    }
    await page.close();
});

test('旋转后新增长中文文本会重新适配位置', async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800 });
    await page.goto(`http://127.0.0.1:${server.address().port}/display.html?displayId=rotation-after-text-test`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000
    });
    await page.waitForFunction(() => typeof window.handleControl === 'function', { timeout: 10000 });

    const boxes = await page.evaluate(() => {
        handleControl({ action: 'rotate', value: 90 });
        const longText = '旋转后新增的连接状态和媒体中文文本不能越界。'.repeat(8);
        const connection = document.getElementById('connectionStatus');
        const fileName = document.getElementById('fileNameDisplay');
        const voiceStatus = document.getElementById('voiceStatus');
        const voiceText = document.getElementById('voiceTextDisplay');
        connection.textContent = longText;
        connection.className = 'connected';
        fileName.textContent = longText;
        fileName.style.display = 'block';
        voiceStatus.textContent = longText;
        voiceText.textContent = longText;
        voiceText.className = 'voice-text-visible';
        voiceStatus.className = 'voice-status-ready';
        return new Promise((resolve) => {
            const waitForFrames = (count) => {
                if (count === 0) {
                    resolve([connection, fileName, voiceStatus, voiceText].map((element) => {
                        const rect = element.getBoundingClientRect();
                        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
                    }));
                    return;
                }
                requestAnimationFrame(() => waitForFrames(count - 1));
            };
            waitForFrames(5);
        });
    });

    for (const box of boxes) {
        assert.ok(box.left >= 19, `新增文本左边界越界: ${JSON.stringify(box)}`);
        assert.ok(box.right <= 1181, `新增文本右边界越界: ${JSON.stringify(box)}`);
        assert.ok(box.top >= 19, `新增文本上边界越界: ${JSON.stringify(box)}`);
        assert.ok(box.bottom <= 781, `新增文本下边界越界: ${JSON.stringify(box)}`);
    }
    await page.close();
});

test('90°和270°旋转后的文本包围盒贴合对应四角锚点', async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800 });
    await page.goto(`http://127.0.0.1:${server.address().port}/display.html?displayId=rotation-anchor-test`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000
    });
    await page.waitForFunction(() => typeof window.handleControl === 'function', { timeout: 10000 });

    const positions = await page.evaluate(async () => {
        const elements = {
            connection: document.getElementById('connectionStatus'),
            time: document.getElementById('timeDisplay'),
            fileName: document.getElementById('fileNameDisplay'),
            voiceStatus: document.getElementById('voiceStatus'),
            voiceText: document.getElementById('voiceTextDisplay')
        };
        const text = '中文角落锚点';
        elements.connection.textContent = text;
        elements.connection.className = 'connected';
        elements.time.textContent = '12:34';
        elements.fileName.textContent = text;
        elements.fileName.style.display = 'block';
        elements.voiceStatus.textContent = text;
        elements.voiceStatus.className = 'voice-status-ready';
        elements.voiceText.textContent = text;
        elements.voiceText.className = 'voice-text-visible';

        const results = {};
        for (const angle of [90, 270]) {
            handleControl({ action: 'rotate', value: angle });
            await new Promise((resolve) => {
                const waitForFrames = (count) => {
                    if (count === 0) {
                        resolve();
                        return;
                    }
                    requestAnimationFrame(() => waitForFrames(count - 1));
                };
                waitForFrames(5);
            });
            results[angle] = Object.fromEntries(
                Object.entries(elements).map(([name, element]) => {
                    const rect = element.getBoundingClientRect();
                    return [name, {
                        left: rect.left,
                        right: rect.right,
                        top: rect.top,
                        bottom: rect.bottom
                    }];
                })
            );
        }
        return results;
    });

    const expectedAnchors = {
        90: {
            connection: ['top', 'right'],
            time: ['bottom', 'right'],
            fileName: ['top', 'left'],
            voiceStatus: ['bottom', 'left'],
            voiceText: ['bottom', 'left']
        },
        270: {
            connection: ['bottom', 'left'],
            time: ['top', 'left'],
            fileName: ['bottom', 'right'],
            voiceStatus: ['top', 'right'],
            voiceText: ['top', 'right']
        }
    };
    for (const [angle, elements] of Object.entries(expectedAnchors)) {
        for (const [name, anchors] of Object.entries(elements)) {
            const box = positions[angle][name];
            for (const anchor of anchors) {
                const actual = box[anchor];
                const expected = anchor === 'left' || anchor === 'top'
                    ? 20
                    : anchor === 'right'
                        ? 1180
                        : 780;
                assert.ok(
                    Math.abs(actual - expected) <= 1.5,
                    `${angle}° ${name} 的 ${anchor} 锚点偏移: ${JSON.stringify(box)}`
                );
            }
        }
    }
    await page.close();
});
