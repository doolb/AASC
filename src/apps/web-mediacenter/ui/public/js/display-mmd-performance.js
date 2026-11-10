/* FPS和CPU/GPU绘制耗时只接收实际帧快照，不开轮询/RAF，不影响指针与画质参数。 */
(function exposeMmdPerformance(root) {
    'use strict';
    function initialize() {
        const canvas = document.getElementById('displayMmdCanvas');
        const hud = document.getElementById('displayMmdFps');
        const render = document.getElementById('displayMmdRenderTime');
        const gpuRender = document.getElementById('displayMmdGpuRenderTime');
        if (!canvas || !hud || !render) return;
        let visible = root.DisplayMmd?.getState?.().visible === true
            || document.getElementById('displayMmdLayer')?.classList.contains('is-visible') === true;
        let insetUpdatePending = false;
        // 先测量原始位置，再把物理屏幕的向下位移转换为旋转画布的局部坐标。
        const updateWallpaperInset = () => {
            insetUpdatePending = false;
            hud.style.translate = '';
            if (hud.hidden) return;
            let inset = 0;
            try { inset = Number(root.NativeDisplay?.getWallpaperTopInset?.()) || 0; } catch (_) { return; }
            if (inset <= 0) return;
            const overlap = Math.max(0, inset - hud.getBoundingClientRect().top);
            if (!overlap) return;
            const rotation = ((Number(root.currentRotation) || 0) % 360 + 360) % 360;
            const offsets = { 0: [0, overlap], 90: [overlap, 0], 180: [0, -overlap], 270: [-overlap, 0] };
            const [x, y] = offsets[rotation] || offsets[0];
            hud.style.translate = `${x}px ${y}px`;
        };
        const scheduleWallpaperInset = () => {
            if (insetUpdatePending) return;
            insetUpdatePending = true;
            root.requestAnimationFrame(updateWallpaperInset);
        };
        root.addEventListener('aasc-wallpaper-inset', scheduleWallpaperInset);
        root.addEventListener('resize', scheduleWallpaperInset);
        const stage = document.getElementById('displayStageLayers');
        if (stage && root.MutationObserver) {
            new root.MutationObserver(scheduleWallpaperInset).observe(stage, { attributes: true, attributeFilter: ['data-rotation'] });
        }
        const apply = data => {
            const wasHidden = hud.hidden;
            hud.hidden = !visible || document.hidden || data?.running !== true;
            if (wasHidden !== hud.hidden) scheduleWallpaperInset();
            hud.textContent = data?.ready && Number.isFinite(data.fps) ? data.fps.toFixed(1) + ' FPS' : '-- FPS';
            render.textContent = data?.ready && Number.isFinite(data.renderMs) ? data.renderMs.toFixed(2) + ' ms' : '-- ms';
            if (gpuRender) gpuRender.textContent = data?.gpuStatus === 'unsupported' ? '不支持'
                : data?.gpuStatus === 'supported' && data?.ready && Number.isFinite(data.gpuRenderMs) ? data.gpuRenderMs.toFixed(2) + ' ms' : '-- ms';
        };
        canvas.addEventListener('mmd-performance', event => apply(event.detail));
        root.addEventListener('display-mmd-visibility', event => { visible = event.detail?.visible === true; apply(null); });
        document.addEventListener('visibilitychange', () => apply(null));
        root.addEventListener('pagehide', () => apply(null));
        apply(null);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
    else initialize();
})(window);
