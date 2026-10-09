'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const puppeteer = require('puppeteer');
const chrome = [process.env.PUPPETEER_EXECUTABLE_PATH, puppeteer.executablePath(),
    'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(file => file && fs.existsSync(file));

test('真实GPU接触alpha保边模糊平滑平面，拒绝深度/法线边缘，另一个通道保持不变', {
    skip: !chrome, timeout: 60000
}, async () => {
    const { filterShader, contactDepthReductionShader } = await import('../3rd/mmd-ar-test/web-screen-lighting-shader.mjs');
    let browser;
    try {
        browser = await puppeteer.launch({ executablePath: chrome, headless: true,
            args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
        const page = await browser.newPage();
        const result = await page.evaluate(({ filterShader, contactDepthReductionShader }) => {
            const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 16;
            const gl = canvas.getContext('webgl2', { antialias: false });
            if (!gl) throw new Error('WebGL2不可用');
            const compile = (type, source) => {
                const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
                if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
                return shader;
            };
            const program = source => {
                const p = gl.createProgram();
                gl.attachShader(p, compile(gl.VERTEX_SHADER, '#version 300 es\nprecision highp float;in vec2 point;out vec2 vUv;void main(){vUv=point*.5+.5;gl_Position=vec4(point,0.,1.);}'));
                gl.attachShader(p, compile(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;\n#define varying in\n#define texture2D texture\nout vec4 outputColor;\n#define gl_FragColor outputColor\n' + source));
                gl.linkProgram(p);
                if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
                gl.useProgram(p);
                const location = gl.getAttribLocation(p, 'point');
                gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
                gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
                return p;
            };
            const texture = (unit, width, height, data, raw = false) => {
                gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
                for (const name of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, name, gl.NEAREST);
                for (const name of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, name, gl.CLAMP_TO_EDGE);
                gl.texImage2D(gl.TEXTURE_2D, 0, raw ? gl.R32F : gl.RGBA8, width, height, 0, raw ? gl.RED : gl.RGBA,
                    raw ? gl.FLOAT : gl.UNSIGNED_BYTE, data);
            };
            const filter = program(filterShader);
            gl.uniform1i(gl.getUniformLocation(filter, 'tInput'), 0); gl.uniform1i(gl.getUniformLocation(filter, 'tDepth'), 1);
            gl.uniformMatrix4fv(gl.getUniformLocation(filter, 'inverseProjection'), false,
                new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1]));
            for (const name of ['fullSize', 'effectSize']) gl.uniform2f(gl.getUniformLocation(filter, name), 32, 16);
            gl.uniform2f(gl.getUniformLocation(filter, 'filterAxis'), 1, 0);
            gl.uniform1i(gl.getUniformLocation(filter, 'blurRadius'), 3);
            const records = [];
            for (const shape of ['flat', 'depth-step', 'normal-fold', 'background']) {
                const input = new Uint8Array(32 * 16 * 4), depth = new Float32Array(32 * 16);
                for (let y = 0; y < 16; y += 1) for (let x = 0; x < 32; x += 1) {
                    const index = (y * 32 + x) * 4;
                    input.set([x === 12 ? 255 : x * 5, y * 10, 50,
                        shape === 'flat' ? (x === 12 ? 255 : 0) : (x < 16 ? 255 : 0)], index);
                    depth[y * 32 + x] = shape === 'flat' ? .5 : shape === 'background' ? (x < 16 ? .5 : 1)
                        : shape === 'depth-step' ? (x < 16 ? .2 : .8) : Math.min(.9, .2 + Math.max(0, x - 15) * .08);
                }
                texture(0, 32, 16, input); texture(1, 32, 16, depth, true);
                for (const contact of [true, false]) {
                    gl.uniform1i(gl.getUniformLocation(filter, 'filterContact'), contact ? 1 : 0);
                    gl.drawArrays(gl.TRIANGLES, 0, 3);
                    const output = new Uint8Array(input.length); gl.readPixels(0, 0, 32, 16, gl.RGBA, gl.UNSIGNED_BYTE, output);
                    records.push({ shape, contact, input: [...input], output: [...output] });
                }
            }
            // 奇数尺寸+单像素薄片+背景混合：直接运行生产2×2范围归约。
            const reduction = program(contactDepthReductionShader);
            // 16位码边界的float32乘法可能向整数舍入；即使只有极小误差，范围也必须向外包住。
            const boundary = Math.fround(32767 / 65535);
            const source = new Float32Array([1, .123456, .8, .9, .7, 1, 1, .3, .4, .6, boundary, boundary, .22, .23, .24]);
            texture(0, 5, 3, source, true);
            gl.uniform1i(gl.getUniformLocation(reduction, 'tInput'), 0);
            gl.uniform2f(gl.getUniformLocation(reduction, 'inputSize'), 5, 3);
            gl.viewport(0, 0, 3, 2); gl.drawArrays(gl.TRIANGLES, 0, 3);
            const reduced = new Uint8Array(3 * 2 * 4); gl.readPixels(0, 0, 3, 2, gl.RGBA, gl.UNSIGNED_BYTE, reduced);
            return { records, source: [...source], reduced: [...reduced], error: gl.getError() };
        }, { filterShader, contactDepthReductionShader });
        assert.equal(result.error, 0);
        for (const record of result.records) {
            const at = (x, channel) => record.output[(8 * 32 + x) * 4 + channel];
            if (record.contact) {
                for (let x = 4; x < 28; x += 1) {
                    if (record.shape === 'background' && x >= 16) continue;
                    const index = (8 * 32 + x) * 4;
                    assert.deepEqual(record.output.slice(index, index + 3), record.input.slice(index, index + 3), '接触滤波不得改变GI RGB');
                }
                if (record.shape === 'flat') {
                    assert.ok(at(12, 3) < 200 && at(11, 3) > 20, '平面alpha尖峰应扩散和平滑');
                } else {
                    assert.ok(at(record.shape === 'normal-fold' ? 18 : 16, 3) <= 2, `${record.shape}另一侧不能收到接触暗色`);
                    assert.ok(at(14, 3) >= 250, `${record.shape}前景侧不能被轮廓外零值冲淡`);
                }
            } else {
                for (let x = 4; x < 28; x += 1) {
                    if (record.shape === 'background' && x >= 16) continue;
                    assert.equal(at(x, 3), record.input[(8 * 32 + x) * 4 + 3], 'GI滤波不得改变接触alpha');
                }
                if (record.shape === 'flat') assert.ok(at(12, 0) < 200, 'GI模式仍滤波RGB');
            }
        }
        for (let y = 0; y < 2; y += 1) for (let x = 0; x < 3; x += 1) {
            const values = [];
            for (let dy = 0; dy < 2; dy += 1) for (let dx = 0; dx < 2; dx += 1) {
                values.push(result.source[Math.min(2, y * 2 + dy) * 5 + Math.min(4, x * 2 + dx)]);
            }
            const i = (y * 3 + x) * 4;
            const near = (result.reduced[i] * 256 + result.reduced[i + 1]) / 65535;
            const far = (result.reduced[i + 2] * 256 + result.reduced[i + 3]) / 65535;
            assert.ok(near <= Math.min(...values) && far >= Math.max(...values), '向外量化范围须覆盖每一个原像素');
            assert.ok(Math.min(...values) - near < 2 / 65535 && far - Math.max(...values) < 2 / 65535);
        }
    } finally { if (browser) await browser.close(); }
});
