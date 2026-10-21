'use strict';

const FIT_MODES = new Set(['contain', 'cover', 'height', 'width', 'dynamic', 'crop']);

function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function normalizeRotation(value) {
    const rotation = ((finite(value, 0) % 360) + 360) % 360;
    if (![0, 90, 180, 270].includes(rotation)) throw new Error('旋转仅支持0/90/180/270度');
    return rotation;
}

function normalizeCrop(value = {}) {
    const x = Math.max(0, Math.min(99.9, finite(value.x, 0)));
    const y = Math.max(0, Math.min(99.9, finite(value.y, 0)));
    return {
        x, y,
        width: Math.max(0.1, Math.min(100 - x, finite(value.width, 100))),
        height: Math.max(0.1, Math.min(100 - y, finite(value.height, 100)))
    };
}

function normalizeDynamic(value = {}) {
    const seconds = (number, fallback) => Math.max(0.1, Math.min(300, finite(number, fallback)));
    return { transitionSeconds: seconds(value.transitionSeconds, 3), holdSeconds: seconds(value.holdSeconds, 2) };
}

/** 按网页显示端的旋转和裁剪规则计算视觉矩形，再换算为mpv的缩放和平移。 */
function calculateGeometry({ width, height, windowWidth, windowHeight, rotation = 0, fit = 'contain', crop }) {
    if (![width, height, windowWidth, windowHeight].every(value => Number.isFinite(value) && value > 0)) return null;
    const turned = normalizeRotation(rotation) % 180 !== 0;
    const ratio = width / height;
    const visualWidth = turned ? height : width;
    const visualHeight = turned ? width : height;
    const contain = Math.min(windowWidth / visualWidth, windowHeight / visualHeight);
    const cover = Math.max(windowWidth / visualWidth, windowHeight / visualHeight);
    const scales = {
        contain,
        cover,
        height: turned ? windowWidth / visualWidth : windowHeight / visualHeight,
        width: turned ? windowHeight / visualHeight : windowWidth / visualWidth
    };
    let targetWidth = visualWidth * (scales[fit] || contain);
    let targetHeight = visualHeight * (scales[fit] || contain);
    let left = (windowWidth - targetWidth) / 2;
    let top = (windowHeight - targetHeight) / 2;

    if (fit === 'crop') {
        const selection = normalizeCrop(crop);
        // 这里刻意沿用网页的displayWidth/displayHeight和旋转轴交换，避免预览框坐标与实播不一致。
        let displayWidth;
        let displayHeight;
        if (turned) {
            const wide = 1 / ratio > windowWidth / windowHeight;
            displayWidth = wide ? windowWidth : windowHeight * ratio;
            displayHeight = wide ? windowWidth / ratio : windowHeight;
        } else {
            const wide = ratio > windowWidth / windowHeight;
            displayWidth = wide ? windowHeight * ratio : windowWidth;
            displayHeight = wide ? windowHeight : windowWidth / ratio;
        }
        const cropWidth = displayWidth * (turned ? selection.height : selection.width) / 100;
        const cropHeight = displayHeight * (turned ? selection.width : selection.height) / 100;
        const scale = Math.max((turned ? windowHeight : windowWidth) / cropWidth,
            (turned ? windowWidth : windowHeight) / cropHeight);
        const cropX = displayWidth * (turned ? selection.y : selection.x) / 100;
        const cropY = displayHeight * (turned ? selection.x : selection.y) / 100;
        targetWidth = (turned ? displayHeight : displayWidth) * scale;
        targetHeight = (turned ? displayWidth : displayHeight) * scale;
        left = -(turned ? cropY : cropX) * scale;
        top = -(turned ? cropX : cropY) * scale;
    }
    return {
        scaleX: targetWidth / (visualWidth * contain),
        scaleY: targetHeight / (visualHeight * contain),
        panX: (left - (windowWidth - targetWidth) / 2) / targetWidth,
        panY: (top - (windowHeight - targetHeight) / 2) / targetHeight,
        width: targetWidth, height: targetHeight, left, top
    };
}

module.exports = { FIT_MODES, normalizeRotation, normalizeCrop, normalizeDynamic, calculateGeometry };
