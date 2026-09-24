const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'src/apps/web-mediacenter/ui/public');
const AR_SOURCE = fs.readFileSync(path.join(PUBLIC_DIR, 'js/display-mmd-ar.js'), 'utf8');

class FakeElement {
    constructor(id = '') {
        this.id = id;
        this.hidden = false;
        this.disabled = false;
        this.checked = false;
        this.value = '';
        this.textContent = '';
        this._width = 0;
        this._height = 0;
        this.sizeAssignments = 0;
        this.listeners = new Map();
        this.attributes = new Map();
        this.children = [];
        this.capturedPointers = new Set();
        this.rect = { left: 100, top: 50, width: 500, height: 300 };
        this.context = {
            arcCalls: [],
            clearRect() {},
            drawImage() {},
            save() {},
            restore() {},
            beginPath() {},
            moveTo() {},
            lineTo() {},
            closePath() {},
            fill() {},
            stroke() {},
            arc(x, y, radius) {
                this.arcCalls.push({ x, y, radius });
            }
        };
    }

    get width() {
        return this._width;
    }

    set width(value) {
        this._width = value;
        this.sizeAssignments += 1;
    }

    get height() {
        return this._height;
    }

    set height(value) {
        this._height = value;
        this.sizeAssignments += 1;
    }

    addEventListener(type, listener) {
        const handlers = this.listeners.get(type) || [];
        handlers.push(listener);
        this.listeners.set(type, handlers);
    }

    dispatch(type, fields = {}) {
        const event = {
            type,
            target: this,
            currentTarget: this,
            pointerId: 1,
            pointerType: 'touch',
            isPrimary: true,
            button: 0,
            clientX: 0,
            clientY: 0,
            cancelable: true,
            defaultPrevented: false,
            preventDefault() {
                this.defaultPrevented = true;
            },
            stopPropagation() {},
            ...fields
        };
        for (const listener of this.listeners.get(type) || []) listener(event);
        return event;
    }

    setAttribute(name, value) {
        this.attributes.set(name, value);
    }

    replaceChildren(...children) {
        this.children = children;
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    getBoundingClientRect() {
        return this.rect;
    }

    getContext() {
        return this.context;
    }

    setPointerCapture(pointerId) {
        this.capturedPointers.add(pointerId);
    }

    hasPointerCapture(pointerId) {
        return this.capturedPointers.has(pointerId);
    }

    releasePointerCapture(pointerId) {
        this.capturedPointers.delete(pointerId);
    }

    toBlob(callback) {
        callback({ type: 'image/jpeg' });
    }
}

function createCalibrationHarness(rotation) {
    const getElementsBlock = AR_SOURCE.match(/function getElements\(\) \{([\s\S]*?)\n    \}/u)?.[1];
    assert.ok(getElementsBlock, '应能找到 AR 控制器 DOM 元素清单');
    const ids = [...getElementsBlock.matchAll(/byId\('([^']+)'\)/gu)].map((match) => match[1]);
    const elements = new Map(ids.map((id) => [id, new FakeElement(id)]));
    const canvas = elements.get('displayArCalibrationCanvas');
    const quarterTurn = rotation === 90 || rotation === 270;
    const rectWidth = quarterTurn ? 300 : 500;
    const rectHeight = quarterTurn ? 500 : 300;
    canvas.rect = {
        left: 600 - rectWidth / 2,
        top: 360 - rectHeight / 2,
        width: rectWidth,
        height: rectHeight
    };
    const documentListeners = new Map();
    const document = {
        readyState: 'loading',
        visibilityState: 'visible',
        addEventListener(type, listener) {
            const handlers = documentListeners.get(type) || [];
            handlers.push(listener);
            documentListeners.set(type, handlers);
        },
        getElementById(id) {
            return elements.get(id) || null;
        },
        createElement(tagName) {
            return new FakeElement(tagName);
        },
        dispatch(type, fields = {}) {
            const event = {
                type,
                target: null,
                pointerId: 1,
                clientX: 0,
                clientY: 0,
                cancelable: true,
                defaultPrevented: false,
                preventDefault() {
                    this.defaultPrevented = true;
                },
                ...fields
            };
            for (const listener of documentListeners.get(type) || []) listener(event);
            return event;
        }
    };
    const localStorageValues = new Map();
    const windowListeners = new Map();
    const window = {
        document,
        localStorage: {
            getItem(key) {
                return localStorageValues.get(key) || null;
            },
            setItem(key, value) {
                localStorageValues.set(key, value);
            },
            removeItem(key) {
                localStorageValues.delete(key);
            }
        },
        DisplayStage: {
            getRotationGeometry() {
                return { rotation, logicalWidth: 500, logicalHeight: 300 };
            },
            mapViewportPointToStage(clientX, clientY, rect, geometry) {
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;
                const deltaX = clientX - centerX;
                const deltaY = clientY - centerY;
                let x;
                let y;
                switch (geometry.rotation) {
                    case 90:
                        x = geometry.logicalWidth / 2 + deltaY;
                        y = geometry.logicalHeight / 2 - deltaX;
                        break;
                    case 180:
                        x = geometry.logicalWidth / 2 - deltaX;
                        y = geometry.logicalHeight / 2 - deltaY;
                        break;
                    case 270:
                        x = geometry.logicalWidth / 2 - deltaY;
                        y = geometry.logicalHeight / 2 + deltaX;
                        break;
                    default:
                        x = geometry.logicalWidth / 2 + deltaX;
                        y = geometry.logicalHeight / 2 + deltaY;
                        break;
                }
                return { x, y };
            }
        },
        addEventListener(type, listener) {
            windowListeners.set(type, listener);
        },
        setTimeout,
        clearTimeout
    };
    const sandbox = {
        window,
        document,
        console: { warn() {}, error() {}, log() {}, debug() {} },
        Date,
        Math,
        Number,
        Object,
        Array,
        Map,
        Set,
        Promise,
        Error,
        Uint8Array,
        setTimeout,
        clearTimeout
    };
    vm.runInNewContext(AR_SOURCE, sandbox, { filename: 'display-mmd-ar.js' });
    return { controller: window.DisplayMmdAr, document, elements };
}

async function prepareCalibration(harness) {
    await harness.controller.initialize();
    const cameraVideo = harness.elements.get('displayArCameraVideo');
    cameraVideo.videoWidth = 1000;
    cameraVideo.videoHeight = 600;
    harness.elements.get('displayArCaptureButton').dispatch('click');
    await new Promise((resolve) => setImmediate(resolve));
    const canvas = harness.elements.get('displayArCalibrationCanvas');
    assert.equal(canvas.hidden, false, '拍照后应显示校准画布');
    canvas.context.arcCalls.length = 0;
    return canvas;
}

function viewportPointForCanvasPoint(point, rotation, rect, logicalWidth = 500, logicalHeight = 300) {
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const localX = (point.x - 0.5) * logicalWidth;
    const localY = (point.y - 0.5) * logicalHeight;
    switch (rotation) {
        case 90:
            return { x: centerX - localY, y: centerY + localX };
        case 180:
            return { x: centerX - localX, y: centerY - localY };
        case 270:
            return { x: centerX + localY, y: centerY - localX };
        default:
            return { x: centerX + localX, y: centerY + localY };
    }
}

test('AR 校准角点始终按弹窗画布本地坐标拖动', async (t) => {
    for (const rotation of [0, 90, 180, 270]) {
        await t.test(`舞台 ${rotation}°`, async () => {
            const harness = createCalibrationHarness(rotation);
            const canvas = await prepareCalibration(harness);
            const sourcePoints = [
                { x: 0.15, y: 0.15 },
                { x: 0.85, y: 0.15 },
                { x: 0.85, y: 0.85 },
                { x: 0.15, y: 0.85 }
            ];
            const movedPoints = [
                { x: 0.18, y: 0.19 },
                { x: 0.82, y: 0.19 },
                { x: 0.82, y: 0.81 },
                { x: 0.18, y: 0.81 }
            ];
            const initialCanvasSizeAssignments = canvas.sizeAssignments;

            for (let index = 0; index < sourcePoints.length; index += 1) {
                const start = sourcePoints[index];
                const moved = movedPoints[index];
                const pointerId = index + 1;
                const startViewport = viewportPointForCanvasPoint(start, rotation, canvas.rect);
                const movedViewport = viewportPointForCanvasPoint(moved, rotation, canvas.rect);
                const down = canvas.dispatch('pointerdown', {
                    pointerId,
                    clientX: startViewport.x,
                    clientY: startViewport.y
                });
                assert.equal(down.defaultPrevented, true);

                harness.document.dispatch('pointermove', {
                    pointerId,
                    clientX: movedViewport.x,
                    clientY: movedViewport.y
                });
                assert.equal(canvas.context.arcCalls.length, 4);
                assert.equal(canvas.sizeAssignments, initialCanvasSizeAssignments, '拖动重绘不得重置 canvas 内在尺寸');
                canvas.context.arcCalls.forEach((point, pointIndex) => {
                    const expected = pointIndex === index ? moved : sourcePoints[pointIndex];
                    assert.ok(
                        Math.abs(point.x - expected.x * canvas.width) < 0.01,
                        `旋转 ${rotation}°，角点 ${index} 的 x 应保持画布本地映射`
                    );
                    assert.ok(
                        Math.abs(point.y - expected.y * canvas.height) < 0.01,
                        `旋转 ${rotation}°，角点 ${index} 的 y 应保持画布本地映射`
                    );
                });
                sourcePoints[index] = moved;

                harness.document.dispatch('pointerup', { pointerId });
                assert.equal(canvas.hasPointerCapture(pointerId), false);
                canvas.context.arcCalls.length = 0;
            }
        });
    }
});

test('AR 校准指针取消或丢失捕获后可再次拖动', async () => {
    const harness = createCalibrationHarness(90);
    const canvas = await prepareCalibration(harness);
    const firstHandle = { x: 0.15, y: 0.15 };

    canvas.dispatch('pointerdown', {
        pointerId: 11,
        clientX: viewportPointForCanvasPoint(firstHandle, 90, canvas.rect).x,
        clientY: viewportPointForCanvasPoint(firstHandle, 90, canvas.rect).y
    });
    harness.document.dispatch('pointercancel', { pointerId: 11 });
    assert.equal(canvas.hasPointerCapture(11), false);

    canvas.dispatch('pointerdown', {
        pointerId: 12,
        clientX: viewportPointForCanvasPoint(firstHandle, 90, canvas.rect).x,
        clientY: viewportPointForCanvasPoint(firstHandle, 90, canvas.rect).y
    });
    canvas.dispatch('lostpointercapture', { pointerId: 12 });
    canvas.context.arcCalls.length = 0;

    canvas.dispatch('pointerdown', {
        pointerId: 13,
        clientX: viewportPointForCanvasPoint(firstHandle, 90, canvas.rect).x,
        clientY: viewportPointForCanvasPoint(firstHandle, 90, canvas.rect).y
    });
    const movedViewport = viewportPointForCanvasPoint({ x: 0.2, y: 0.2 }, 90, canvas.rect);
    harness.document.dispatch('pointermove', {
        pointerId: 13,
        clientX: movedViewport.x,
        clientY: movedViewport.y
    });
    assert.equal(canvas.context.arcCalls.length, 4);
    assert.ok(Math.abs(canvas.context.arcCalls[0].x - canvas.width * 0.2) < 0.01);
    assert.ok(Math.abs(canvas.context.arcCalls[0].y - canvas.height * 0.2) < 0.01);
});

test('AR 校准触控画布禁止浏览器手势抢占', () => {
    const css = fs.readFileSync(path.join(PUBLIC_DIR, 'css/display-mmd.css'), 'utf8');
    assert.match(css, /\.display-mmd-ar-camera,[\s\S]*?touch-action:\s*none/u);
    assert.match(css, /\.display-mmd-ar-canvas\s*\{[^}]*-webkit-user-select:\s*none/u);
    assert.match(css, /\.display-mmd-ar-canvas\s*\{[^}]*-webkit-user-drag:\s*none/u);
});
