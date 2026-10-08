'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const puppeteer = require('puppeteer');

const chrome = [process.env.PUPPETEER_EXECUTABLE_PATH, puppeteer.executablePath(), '/usr/bin/chromium',
    'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(file => file && fs.existsSync(file));

test('接触阴影真实GLSL细化大跨越，并保留厚度及自遮挡保护', {
    skip: !chrome, timeout: 60000
}, async () => {
    const { fragmentShader } = await import('../3rd/mmd-ar-test/web-screen-lighting-shader.mjs');
    // 执行生产追踪函数；仅替换入口，使用独立定义的可解析深度场验证真实GPU返回值。
    const traceName = fragmentShader.includes('bool traceCurrent(') ? 'traceCurrent' : 'trace';
    const withDistance = traceName === 'traceCurrent';
    const withStepArgument = /bool traceCurrent\([^\n]*int sampleCount/u.test(fragmentShader);
    const withExitArgument = /bool traceCurrent\([^\n]*bool allowExit/u.test(fragmentShader);
    const entry = `void main(){vec2 uv;vec3 hit;float confidence;float hitDistance;
        bool found=${traceName}(vec3(-.8,0.,0.),vec3(1.,0.,0.),testDistance,.001,${withStepArgument ? 'stepCount,' : ''}${withExitArgument ? 'testAllowExit,' : ''}uv,hit,confidence${withDistance ? ',hitDistance' : ''});
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
    const instrumented = 'uniform sampler2D tDepth;uniform mat4 projection,inverseProjection;uniform int stepCount;uniform float testDistance;uniform bool testAllowExit;\n'
        + [extract('positionAt'), extract('inside'), extract(traceName), entry].join('\n');
    let browser;
    try {
        browser = await puppeteer.launch({ executablePath: chrome, headless: true,
            args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
        const page = await browser.newPage();
        const result = await page.evaluate(instrumented => {
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
            for (const name of ['projection', 'inverseProjection']) gl.uniformMatrix4fv(gl.getUniformLocation(program, name), false, identity);
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.uniform1i(gl.getUniformLocation(program, 'tDepth'), 0);
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
            for (const steps of [4, 12, 20, 30, 32, 64]) {
                gl.uniform1i(gl.getUniformLocation(program, 'stepCount'), steps);
                for (const fixture of fixtures) {
                    const data = new Float32Array(4096);
                    for (let i = 0; i < data.length; i += 1) data[i] = fixture.surface((i + .5) / data.length * 2 - 1) * .5 + .5;
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, data.length, 1, 0, gl.RED, gl.FLOAT, data);
                    gl.uniform1f(gl.getUniformLocation(program, 'testDistance'), fixture.distance);
                    for (const allowExit of fixture.name === 'reverse-crossing' ? [true, false] : [true]) {
                        gl.uniform1i(gl.getUniformLocation(program, 'testAllowExit'), allowExit ? 1 : 0);
                        gl.drawArrays(gl.TRIANGLES, 0, 3); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                        samples.push({ name: fixture.name, steps, allowExit, found: pixels[0] > 127, confidence: pixels[1] });
                    }
                }
            }
            return { samples, error: gl.getError() };
        }, instrumented);
        assert.equal(result.error, 0, 'GPU操作不能包含GL错误');
        for (const sample of result.samples) {
            const expected = ['large-crossing', 'small-crossing', 'late-crossing'].includes(sample.name)
                || sample.name === 'reverse-crossing' && sample.allowExit;
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
    const { vertexShader, fragmentShader, filterShader, colorReductionShader, depthReductionShader } =
        await import('../3rd/mmd-ar-test/web-screen-lighting-shader.mjs');
    const sources = { ssgi: fragmentShader, bilateral: filterShader, colorReduction: colorReductionShader, depthReduction: depthReductionShader };
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
        assert.ok(compiled.textureUnits >= 15, 'WebGL2最低需可绑定当前SSGI历史采样器');
        assert.equal(compiled.error, 0);
    } finally {
        if (browser) await browser.close();
    }
});
