// 控制模式共享工具：坐标换算与 720p 缩放（浏览器/Node 双导出）
(function (global) {
    'use strict';

    // 限幅：v 限制在 [min, max]
    function clamp(v, min, max) {
        return Math.min(max, Math.max(min, v));
    }

    // 裁剪框内相对百分比 (px,py)（0~100）→ 内容百分比坐标
    // 裁剪框定义在内容坐标系（crop.x/y/width/height 均为内容百分比），
    // 因此框内相对坐标线性映射到内容区域，与显示端 CSS transform 缩放无关
    function contentPointFromCropBox(crop, px, py) {
        return {
            x: crop.x + (clamp(px, 0, 100) * crop.width) / 100,
            y: crop.y + (clamp(py, 0, 100) * crop.height) / 100
        };
    }

    // 内容百分比坐标 → 内容像素坐标（iframe 内容坐标系）
    function contentPixelFromPercent(contentW, contentH, pct) {
        return {
            x: Math.round((contentW * pct.x) / 100),
            y: Math.round((contentH * pct.y) / 100)
        };
    }

    // 等比缩放到 720p 级别（最长边 ≤ 1280，即 720p 的横向宽度）；原尺寸更小则保持不变
    function fitSizeTo720p(w, h) {
        const maxLongEdge = 1280;
        const scale = Math.min(1, maxLongEdge / Math.max(w, h));
        return {
            width: Math.round(w * scale),
            height: Math.round(h * scale)
        };
    }

    const api = { clamp, contentPointFromCropBox, contentPixelFromPercent, fitSizeTo720p };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    global.ControlModeUtils = api;
})(typeof window !== 'undefined' ? window : globalThis);
