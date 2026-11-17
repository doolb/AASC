const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const puppeteer = require('puppeteer-core');

test('真实浏览器播放背景音视频时输出非零音频并可切换为图片', { timeout: 30000 }, async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-background-media-'));
    t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
    const audioPath = path.join(directory, 'sound.wav');
    const videoPath = path.join(directory, 'video.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '2', audioPath]);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=64x64:r=10', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', videoPath]);
    const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent('<img id="backgroundMediaImage"><video id="backgroundMediaVideo"></video><audio id="backgroundMediaAudio"></audio><div id="mainMedia">主内容</div>');
    await page.addScriptTag({ path: path.resolve('src/apps/web-mediacenter/ui/public/js/display-background-media.js') });
    for (const [mediaType, file, mime, id] of [['audio', audioPath, 'audio/wav', 'backgroundMediaAudio'], ['video', videoPath, 'video/mp4', 'backgroundMediaVideo']]) {
        const result = await page.evaluate(async ({ mediaType, data, mime, id }) => {
            const player = window.DisplayBackgroundMedia;
            const element = document.getElementById(id);
            const context = new AudioContext();
            const analyser = context.createAnalyser();
            context.createMediaElementSource(element).connect(analyser);
            analyser.connect(context.destination);
            await context.resume();
            player.apply({ url: `data:${mime};base64,${data}`, mediaType, playing: true, volume: 50, loop: true });
            const samples = new Uint8Array(analyser.fftSize);
            let peak = 0;
            for (let attempt = 0; attempt < 30 && !peak; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 100));
                analyser.getByteTimeDomainData(samples);
                peak = Math.max(...samples.map(value => Math.abs(value - 128)));
            }
            const result = { peak, muted: element.muted, paused: element.paused, volume: element.volume, readyState: element.readyState, contextState: context.state, currentTime: element.currentTime };
            player.apply({ url: '', playing: false });
            await context.close();
            return result;
        }, { mediaType, id, mime, data: fs.readFileSync(file).toString('base64') });
        assert.equal(result.muted, false);
        assert.equal(result.paused, false);
        assert.equal(result.volume, 0.5);
        assert.ok(result.peak > 0, `${mediaType} 应输出非零音频: ${JSON.stringify(result)}`);
    }
    const shown = await page.evaluate(() => {
        window.DisplayBackgroundMedia.apply({ url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', mediaType: 'image', playing: true, volume: 50 });
        return [document.getElementById('backgroundMediaImage').style.display, document.getElementById('mainMedia').textContent];
    });
    assert.deepEqual(shown, ['block', '主内容']);
});
