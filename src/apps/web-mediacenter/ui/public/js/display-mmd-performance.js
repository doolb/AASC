/* FPS和CPU绘制耗时只接收实际帧发布的快照，不开轮询/RAF，不影响指针与画质参数。 */
(function exposeMmdPerformance(root) {
    'use strict';
    function initialize() {
        const canvas = document.getElementById('displayMmdCanvas');
        const hud = document.getElementById('displayMmdFps');
        const render = document.getElementById('displayMmdRenderTime');
        if (!canvas || !hud || !render) return;
        let visible = root.DisplayMmd?.getState?.().visible === true
            || document.getElementById('displayMmdLayer')?.classList.contains('is-visible') === true;
        const apply = data => {
            hud.hidden = !visible || document.hidden || data?.running !== true;
            hud.textContent = data?.ready && Number.isFinite(data.fps) ? data.fps.toFixed(1) + ' FPS' : '-- FPS';
            render.textContent = data?.ready && Number.isFinite(data.renderMs) ? data.renderMs.toFixed(2) + ' ms' : '-- ms';
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
