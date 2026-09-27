'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const puppeteer = require('puppeteer-core');

const PUBLIC = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const TARGET = path.resolve(__dirname, '../3rd/mmd-ar-test/testimg/mindar.JPG');
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/usr/bin/chromium']
    .find((candidate) => candidate && fs.existsSync(candidate));

test('正式 MindAR 只在开始后加载本地脚本，并在停止后释放模拟摄像头', {
    skip: !CHROME || !fs.existsSync(TARGET), timeout: 120000
}, async () => {
    const server = http.createServer((request, response) => {
        const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
        if (pathname === '/testimg/mindar.JPG') {
            response.setHeader('Content-Type', 'image/jpeg');
            fs.createReadStream(TARGET).pipe(response);
            return;
        }
        if (pathname === '/') {
            response.setHeader('Content-Type', 'text/html');
            response.end(`<!doctype html><html><head><meta charset="utf-8"><style>
                html,body,#displayArAframeHost{width:100%;height:100%;margin:0}
                #displayArAframeHost{position:fixed;inset:0}
                #displayArAframeHost[hidden]{display:none}
                a-scene{position:absolute;inset:0;width:100%;height:100%;opacity:0}
                .display-mmd-ar-mindar-video{position:absolute;inset:0;width:100%;height:100%}
            </style></head><body><div id="displayArAframeHost" hidden></div>
            <script>window.DisplayMmd={setArCameraPose:()=>true,suspendArCameraPose:()=>{},resetArCameraPose:()=>{}};</script>
            <script src="/js/display-mmd-ar-mindar.js"></script></body></html>`);
            return;
        }
        const absolute = path.resolve(PUBLIC, `.${pathname}`);
        if (!absolute.startsWith(`${PUBLIC}${path.sep}`) || !fs.existsSync(absolute)
            || !fs.statSync(absolute).isFile()) return void response.writeHead(404).end();
        response.setHeader('Content-Type', /\.m?js$/u.test(absolute) ? 'text/javascript' : 'application/octet-stream');
        fs.createReadStream(absolute).pipe(response);
    });
    let browser;
    try {
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 120000,
            args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
        const page = await browser.newPage();
        const requests = [];
        const pageErrors = [];
        page.on('request', (request) => requests.push(request.url()));
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
        const initial = await page.evaluate(() => ({ aframe: !!window.AFRAME, tracker: !!window.DisplayMmdMindArTracker }));
        assert.deepEqual(initial, { aframe: false, tracker: true });
        const result = await page.evaluate(async () => {
            const bitmap = await createImageBitmap(await (await fetch('/testimg/mindar.JPG')).blob());
            const canvas = document.createElement('canvas');
            canvas.width = 640;
            canvas.height = 480;
            const context = canvas.getContext('2d');
            context.drawImage(bitmap, 0, 0, 640, 480);
            const interval = setInterval(() => context.drawImage(bitmap, 0, 0, 640, 480), 50);
            const streams = [];
            const original = navigator.mediaDevices.getUserMedia;
            navigator.mediaDevices.getUserMedia = async () => {
                const stream = canvas.captureStream(20);
                streams.push(stream);
                return stream;
            };
            try {
                const target = {
                    referenceImageBlob: await (await fetch('/testimg/mindar.JPG')).blob(),
                    selectedQuad: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
                };
                const session = await window.DisplayMmdMindArTracker.start(target);
                const loaded = !!window.AFRAME && !!document.querySelector('a-scene');
                await session.stop();
                const restarted = await window.DisplayMmdMindArTracker.start(target);
                await restarted.stop();
                return { loaded, streamCount: streams.length,
                    stopped: streams.every((stream) => stream.getVideoTracks()[0].readyState === 'ended'),
                    hidden: document.getElementById('displayArAframeHost').hidden };
            } finally {
                clearInterval(interval);
                navigator.mediaDevices.getUserMedia = original;
                bitmap.close();
            }
        });
        assert.deepEqual(result, { loaded: true, streamCount: 2, stopped: true, hidden: true });
        assert.equal(requests.some((url) => /aframe\.io|cdn\.jsdelivr\.net/u.test(url)), false);
        assert.deepEqual(pageErrors, []);
    } finally {
        await browser?.close();
        await new Promise((resolve) => server.close(resolve));
    }
});
