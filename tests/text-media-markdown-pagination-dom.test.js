'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const WebSocket = require('ws');
const puppeteer = require('puppeteer');

test('Markdown 分页按显示内容区真实布局分页，不裁切段落、列表、引用和代码块', async () => {
    const app = express();
    app.use(express.static('src/apps/web-mediacenter/ui/public'));
    const server = http.createServer(app);
    const wss = new WebSocket.Server({ server });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 320, height: 240 });
        await page.goto(`http://127.0.0.1:${server.address().port}/display.html?displayId=markdown-pagination-test`, { waitUntil: 'load' });
        await page.waitForFunction(() => window.TextMediaPlayer && window.ChatMarkdown);

        const markdown = [
            '# 连续段落标题',
            '第一段连续文字需要在显示区域按真实段落高度分页。'.repeat(8),
            '第二段连续文字同样没有空行，不能在页末被隐藏裁切。'.repeat(8),
            '- 列表项目一：列表每项都要完整可见。',
            '- 列表项目二：列表连续出现时不能只按源码行高估算。',
            '- 列表项目三：分页后仍要保持全部文本。',
            '> 引用第一行：引用块带有自己的渲染结构。',
            '> 引用第二行：必须按实际高度分页。',
            '```text',
            '代码块第一行：需要保留原始换行。',
            '代码块第二行：不能被内容区 overflow 隐藏。',
            '代码块第三行：真实高度必须纳入量测。',
            '```'
        ].join('\n');

        const pageMetrics = await page.evaluate(async (source) => {
            const player = window.TextMediaPlayer;
            player.configure({
                style: { fontSize: 'small', lineHeight: 'normal', pageMargin: 'small' },
                splitIntoSentences: (text) => [text]
            });
            await player.loadText(source, 'markdown');
            const result = [];
            const total = player.getProgress().pageTotal;
            for (let index = 0; index < total; index += 1) {
                const content = document.getElementById('mediaTextContent');
                result.push({
                    scrollHeight: content.scrollHeight,
                    clientHeight: content.clientHeight,
                    text: content.textContent
                });
                if (index + 1 < total) player.handleControl('next');
            }
            return result;
        }, markdown);

        assert.ok(pageMetrics.length > 1, '夹具应产生多页');
        assert.ok(pageMetrics.every((metric) => metric.scrollHeight <= metric.clientHeight), JSON.stringify(pageMetrics));
        assert.match(pageMetrics.map((metric) => metric.text).join('\n'), /代码块第三行/);
    } finally {
        await browser.close();
        wss.close();
        await new Promise((resolve) => server.close(resolve));
    }
});
