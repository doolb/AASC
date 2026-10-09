'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const puppeteer = require('puppeteer');

const chrome = [process.env.PUPPETEER_EXECUTABLE_PATH, puppeteer.executablePath(), '/usr/bin/chromium',
    'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(file => file && fs.existsSync(file));

for (const optimized of [false, 'orthographic', 'perspective']) test(`${optimized ? `优化接触(${optimized})` : 'GI回退原'}追踪真实GLSL细化双向跨越，并保留厚度及自遮挡保护`, {
    skip: !chrome, timeout: 60000
}, async () => {
    const { fragmentShader } = await import('../3rd/mmd-ar-test/web-screen-lighting-shader.mjs');
    // 执行生产追踪函数；仅替换入口，使用独立定义的可解析深度场验证真实GPU返回值。
    const traceName = optimized ? 'traceContact' : 'traceCurrent';
    assert.ok(fragmentShader.includes(`bool ${traceName}(`), '生产入口必须存在，不能只验证旧追踪');
    const withDistance = true;
    const withStepArgument = true;
    const withExitArgument = !optimized;
    const entry = `void main(){vec2 uv;vec3 hit;float confidence;float hitDistance;
        bool found=${traceName}(testStart,testDirection,testDistance,${optimized === 'perspective' ? '.002' : '.001'},${withStepArgument ? 'stepCount,' : ''}${withExitArgument ? 'testAllowExit,' : ''}uv,hit,confidence${withDistance ? ',hitDistance' : ''});
        gl_FragColor=vec4(found?1.:0.,found?confidence:0.,0.,1.);}`;
    const extract = name => {
        const begin = fragmentShader.indexOf(name + '(');
        const start = fragmentShader.lastIndexOf('\n', begin) + 1;
        let end = fragmentShader.indexOf('{', begin), nesting = 1;
        while (nesting > 0) {
            end += 1;
            if (fragmentShader[end] === '{') nesting += 1;
            if (fragmentShader[end] === '}') nesting -= 1;
        }
        return fragmentShader.slice(start, end + 1);
    };
    // 隔离无关历史追踪，执行原始函数体，不将GLSL算法复制成JS参考实现。
    const instrumented = 'uniform highp sampler2D tDepth,tContactDepth;uniform mat4 projection,inverseProjection;uniform vec2 fullSize;uniform vec3 testStart,testDirection;uniform int stepCount;uniform float testDistance,contactFramePhase;uniform bool testAllowExit;\n'
        + [extract('positionAt'), extract('inside'), ...(optimized ? [extract('clipContactPlane'), extract('contactRaySegment'), extract('contactBiasAt')] : []), extract(traceName), entry].join('\n');
    let browser;
    try {
        browser = await puppeteer.launch({ executablePath: chrome, headless: true,
            args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
        const page = await browser.newPage();
        const result = await page.evaluate(({ instrumented, optimized }) => {
            const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
            const gl = canvas.getContext('webgl2', { antialias: false });
            if (!gl) throw new Error('WebGL2不可用');
            const vertex = '#version 300 es\nin vec2 point;void main(){gl_Position=vec4(point,0.,1.);}';
            const compile = (type, source) => {
                const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
                if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
                return shader;
            };
            const link = source => {
                const program = gl.createProgram();
                gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
                const prefix = '#version 300 es\nprecision highp float;\n#define texture2D texture\nout highp vec4 outColor;\n#define gl_FragColor outColor\n';
                gl.attachShader(program, compile(gl.FRAGMENT_SHADER, prefix + source));
                gl.linkProgram(program);
                if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
                return program;
            };
            const program = link(instrumented); gl.useProgram(program);
            const point = gl.getAttribLocation(program, 'point');
            gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
            gl.enableVertexAttribArray(point); gl.vertexAttribPointer(point, 2, gl.FLOAT, false, 0, 0);
            const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
            if (optimized) identity[10] = -1; // 普通Z正交投影，朝相机的表面具有较小deviceDepth。
            const inverse = new Float32Array(identity), perspective = optimized === 'perspective';
            const a = -(10 + .1) / (10 - .1), b = -2 * 10 * .1 / (10 - .1);
            if (perspective) {
                identity[10] = a; identity[11] = -1; identity[14] = b; identity[15] = 0;
                inverse[10] = 0; inverse[11] = 1 / b; inverse[14] = -1; inverse[15] = a / b;
            }
            gl.uniformMatrix4fv(gl.getUniformLocation(program, 'projection'), false, identity);
            gl.uniformMatrix4fv(gl.getUniformLocation(program, 'inverseProjection'), false, inverse);
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.uniform1i(gl.getUniformLocation(program, 'tDepth'), 0);
            gl.uniform2f(gl.getUniformLocation(program, 'fullSize'), 4096, 1);
            const fineTexture = gl.getParameter(gl.TEXTURE_BINDING_2D), coarseTexture = gl.createTexture();
            const pixels = new Uint8Array(4), samples = [];
            const fixtures = [
                // 连续斜面在x=-0.78与射线相交，粗步深度超过厚度，但精确命中有效。
                { name: 'large-crossing', surface: x => Math.max(-.4, Math.min(.32, 4 * (x + .78))), distance: 1.2 },
                { name: 'small-crossing', surface: x => Math.max(-.4, Math.min(.02, x + .78)), distance: 1.2 },
                // 相交点在射程75%处，64步时必须执行第32步之后的采样才能命中。
                { name: 'late-crossing', surface: x => Math.max(-.4, Math.min(.32, 4 * (x - .1))), distance: 1.2 },
                // 射线先从轮廓进入厚度范围外，之后连续穿出表面；接触阴影不能仅接受正向穿越。
                { name: 'reverse-crossing', surface: x => x < -.65 ? -.2 : Math.max(-.4, .6 - (x + .65) * 1.5), distance: 1.2 },
                // 深度轮廓跳变不与射线真正相交，细化后的厚度仍必须将它拒绝。
                { name: 'thick-discontinuity', surface: x => x < -.75 ? -.2 : .5, distance: 1.2 },
                { name: 'double-discontinuity', surface: x => x < -.65 || x > .1 ? -.2 : .6, distance: 1.2 },
                { name: 'clear', surface: () => -.2, distance: 1.2 },
                { name: 'self', surface: () => .0015, distance: .024 },
                { name: 'background', surface: () => 1, distance: 1.2 }
            ];
            if (perspective) fixtures.push(
                ...[-.5, -.3].map(z => ({ name: `toward-camera-${z}`, surface: x => x < -.2 ? -2 : z,
                    distance: 3, world: true, start: [-.8, 0, -2], direction: [1 / Math.sqrt(5), 0, 2 / Math.sqrt(5)] })),
                // .45方向保持UV在屏内，射线终点真正落在near=.1面，而非先碰到右屏幕边缘。
                ...[-.3, -.15].map(z => ({ name: `toward-camera-near-plane-${z}`, surface: x => x < -.38 ? -2 : z,
                    distance: 3, world: true, start: [-.8, 0, -2], direction: [.45 / Math.hypot(.45, 1), 0, 1 / Math.hypot(.45, 1)] })),
                { name: 'near-clip-clear', surface: () => -2, distance: 3, world: true,
                    start: [-.8, 0, -2], direction: [1 / Math.sqrt(5), 0, 2 / Math.sqrt(5)] });
            for (const steps of [4, 12, 20, 30, 32, 64]) {
                gl.uniform1i(gl.getUniformLocation(program, 'stepCount'), steps);
                for (const fixture of fixtures) {
                    gl.uniform3fv(gl.getUniformLocation(program, 'testStart'), fixture.start || (perspective ? [-1.6, 0, -2] : [-.8, 0, 0]));
                    gl.uniform3fv(gl.getUniformLocation(program, 'testDirection'), fixture.direction || [1, 0, 0]);
                    const data = new Float32Array(4096);
                    for (let i = 0; i < data.length; i += 1) {
                        const surface = fixture.surface((i + .5) / data.length * 2 - 1);
                        const z = fixture.world ? surface : -2 + surface * 2;
                        data[i] = fixture.name === 'background' ? 1 : perspective ? (a * z + b) / -z * .5 + .5
                            : surface * (optimized ? -.5 : .5) + .5;
                    }
                    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fineTexture);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, data.length, 1, 0, gl.RED, gl.FLOAT, data);
                    if (optimized) {
                        const coarse = new Uint8Array(data.length / 2 * 4);
                        for (let i = 0; i < data.length / 2; i += 1) {
                            const nearCode = Math.floor(Math.min(data[i * 2], data[i * 2 + 1]) * 65535);
                            const farCode = Math.ceil(Math.max(data[i * 2], data[i * 2 + 1]) * 65535);
                            coarse.set([nearCode >> 8, nearCode & 255, farCode >> 8, farCode & 255], i * 4);
                        }
                        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, coarseTexture);
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, data.length / 2, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, coarse);
                        gl.uniform1i(gl.getUniformLocation(program, 'tContactDepth'), 1);
                    }
                    gl.uniform1f(gl.getUniformLocation(program, 'testDistance'), fixture.distance * (perspective && !fixture.world ? 2 : 1));
                    for (const allowExit of fixture.name === 'reverse-crossing' && !optimized ? [true, false] : [true]) {
                        gl.uniform1i(gl.getUniformLocation(program, 'testAllowExit'), allowExit ? 1 : 0);
                        gl.drawArrays(gl.TRIANGLES, 0, 3); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                        samples.push({ name: fixture.name, steps, allowExit, found: pixels[0] > 127, confidence: pixels[1] });
                    }
                }
            }
            return { samples, error: gl.getError() };
        }, { instrumented, optimized });
        assert.equal(result.error, 0, 'GPU操作不能包含GL错误');
        for (const sample of result.samples) {
            const expected = ['large-crossing', 'small-crossing', 'late-crossing'].includes(sample.name)
                || sample.name === 'reverse-crossing' && sample.allowExit || sample.name.startsWith('toward-camera');
            assert.equal(sample.found, expected, `${sample.name}，${sample.steps}步，反向=${sample.allowExit}`);
            if (expected) assert.ok(sample.confidence > 127, `${sample.name}细化后应有稳定遮挡置信度`);
        }
    } finally {
        if (browser) await browser.close();
    }
});

test('SSGI历史重投影、深度Reduction/HZB及双边滤波Shader可编译链接', {
    skip: !chrome, timeout: 60000
}, async () => {
    const { vertexShader, fragmentShader, filterShader, colorReductionShader, depthReductionShader, contactDepthReductionShader } =
        await import('../3rd/mmd-ar-test/web-screen-lighting-shader.mjs');
    const sources = { ssgi: fragmentShader, bilateral: filterShader, colorReduction: colorReductionShader, depthReduction: depthReductionShader, contactDepth: contactDepthReductionShader };
    assert.doesNotMatch(JSON.stringify(sources), /\bpacked\b/u, 'packed是GLSL保留字，不得作变量名');
    let browser;
    try {
        browser = await puppeteer.launch({ executablePath: chrome, headless: true,
            args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
        const page = await browser.newPage();
        const compiled = await page.evaluate(({ vertexSource, fragments }) => {
            const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
            const gl = canvas.getContext('webgl2', { antialias: false });
            if (!gl) throw new Error('WebGL2不可用');
            const vertex = `#version 300 es\nprecision highp float;\nin vec3 position;in vec2 uv;\n#define varying out\n${vertexSource}`;
            const compile = (type, source, name) => {
                const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
                if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`${name}: ${gl.getShaderInfoLog(shader)}`);
                return shader;
            };
            const names = [];
            for (const [name, source] of Object.entries(fragments)) {
                const program = gl.createProgram();
                const fragment = `#version 300 es\nprecision highp float;\n#define varying in\n#define texture2D texture\nout highp vec4 outColor;\n#define gl_FragColor outColor\n${source}`;
                gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex, `${name} vertex`));
                gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment, `${name} fragment`));
                gl.linkProgram(program);
                if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`${name} link: ${gl.getProgramInfoLog(program)}`);
                names.push(name); gl.deleteProgram(program);
            }
            return { names, textureUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS), error: gl.getError() };
        }, { vertexSource: vertexShader, fragments: sources });
        assert.deepEqual(compiled.names, Object.keys(sources));
        assert.ok(compiled.textureUnits >= 16, 'WebGL2最低需可绑定SSGI历史和当前接触粗深度采样器');
        assert.equal(compiled.error, 0);
    } finally {
        if (browser) await browser.close();
    }
});
