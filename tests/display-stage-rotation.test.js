'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DISPLAY_STAGE_PATH = path.resolve(
    __dirname,
    '../src/apps/web-mediacenter/ui/public/js/display-stage.js'
);
const DISPLAY_STAGE_SOURCE = fs.readFileSync(DISPLAY_STAGE_PATH, 'utf8');

function loadDisplayStageApi() {
    const document = {
        readyState: 'loading',
        addEventListener() {}
    };
    const window = { currentRotation: 0 };
    vm.runInNewContext(DISPLAY_STAGE_SOURCE, { window, document, console });
    return window.DisplayStage;
}

test('交互舞台按四个直角旋转角度交换逻辑尺寸并映射安全区和键盘边缘', () => {
    const stage = loadDisplayStageApi();
    const expected = {
        0: { width: 1920, height: 1080, keyboardEdge: 'bottom', safeTop: 'top' },
        90: { width: 1080, height: 1920, keyboardEdge: 'right', safeTop: 'right' },
        180: { width: 1920, height: 1080, keyboardEdge: 'top', safeTop: 'bottom' },
        270: { width: 1080, height: 1920, keyboardEdge: 'left', safeTop: 'left' }
    };

    for (const [angle, result] of Object.entries(expected)) {
        const geometry = stage.getRotationGeometry(1920, 1080, Number(angle), 240);
        assert.equal(geometry.rotation, Number(angle));
        assert.equal(geometry.logicalWidth, result.width);
        assert.equal(geometry.logicalHeight, result.height);
        assert.equal(geometry.keyboardInsets[result.keyboardEdge], 240);
        assert.equal(geometry.safeAreaSources.top, result.safeTop);
    }
    assert.equal(stage.getRotationGeometry(1920, 1080, 450).rotation, 90);
    assert.equal(stage.getRotationGeometry(1920, 1080, 45).rotation, 0);
});

test('MMD 指针坐标按视口旋转的逆变换映射到逻辑 Canvas 四角', () => {
    const stage = loadDisplayStageApi();
    const rect = { left: 0, top: 0, width: 1920, height: 1080 };
    const physicalCorners = [
        [0, 0],
        [1920, 0],
        [0, 1080],
        [1920, 1080]
    ];
    const expectedLogicalCorners = {
        0: [[0, 0], [1920, 0], [0, 1080], [1920, 1080]],
        90: [[0, 1920], [0, 0], [1080, 1920], [1080, 0]],
        180: [[1920, 1080], [0, 1080], [1920, 0], [0, 0]],
        270: [[1080, 0], [1080, 1920], [0, 0], [0, 1920]]
    };

    for (const [angle, expectedCorners] of Object.entries(expectedLogicalCorners)) {
        const geometry = stage.getRotationGeometry(1920, 1080, Number(angle));
        for (let index = 0; index < physicalCorners.length; index += 1) {
            const [clientX, clientY] = physicalCorners[index];
            const point = stage.mapViewportPointToStage(clientX, clientY, rect, geometry);
            assert.deepEqual([point.x, point.y], expectedCorners[index], `${angle}° corner ${index}`);
        }
        const center = stage.mapViewportPointToStage(960, 540, rect, geometry);
        assert.equal(center.normalizedX, 0);
        assert.equal(center.normalizedY, 0);
    }
});
