'use strict';
// B站弹幕渲染层：独立脚本只负责在视频上方调度/绘制弹幕，不参与媒体加载。
// 生命周期严格跟随 showMedia 创建的控制器实例，视频切换时由显示端主脚本销毁。
(function () {
    // mode 与 B站接口保持一致：1 滚动、4 底部、5 顶部。
    const LANES = { 1: 'scroll', 4: 'bottom', 5: 'top' };
    const MAX_ACTIVE = 80;
    const SCROLL_LIFE_SECONDS = 9;
    const FIXED_LIFE_SECONDS = 4.5;
    const SEEK_TOLERANCE_SECONDS = 0.05;
    const LANE_COUNT = 10;
    const LANE_START_PERCENT = 6;
    const LANE_STEP_PERCENT = 8;

    // 服务端返回十进制颜色值，统一转换为六位十六进制，异常值回退白色。
    function normalizeColor(value) {
        const color = Number(value);
        if (!Number.isFinite(color) || color < 0) return '#ffffff';
        return `#${Math.min(0xffffff, Math.floor(color)).toString(16).padStart(6, '0')}`;
    }

    // 字号限制在 14-36px，避免极端值撑破弹幕轨道。
    function normalizeFontSize(value) {
        const size = Number(value);
        const fontSize = Number.isFinite(size) && size > 0 ? size : 25;
        return `${Math.max(14, Math.min(36, fontSize))}px`;
    }

    function create(options = {}) {
        const container = options.container;
        const video = options.video;
        if (!container || !video || !options.url) throw new Error('弹幕初始化参数无效');

        const layer = document.createElement('div');
        layer.className = 'bilibili-danmaku-layer';
        container.appendChild(layer);

        let visible = true;
        let destroyed = false;
        let started = false;
        let resync = false;
        let items = [];
        let cursor = 0;
        let frame = 0;
        let lastTime = 0;
        const active = new Set();

        function removeNode(node) {
            node.remove();
        }

        function clearActive() {
            active.forEach(removeNode);
            active.clear();
        }

        // 暂停时冻结 CSS 动画；继续播放恢复。初始化时同步一次当前视频状态。
        function syncPausedClass() {
            layer.classList.toggle('paused', video.paused === true);
        }

        // seek 后必须重新定位游标，不能把历史弹幕一次性重新塞满。
        function markResync() {
            resync = true;
        }

        video.addEventListener('pause', syncPausedClass);
        video.addEventListener('play', syncPausedClass);
        video.addEventListener('seeked', markResync);
        syncPausedClass();

        function schedule(item) {
            if (active.size >= MAX_ACTIVE) return;
            const span = document.createElement('span');
            const lane = LANES[item.mode] || LANES[1];
            span.className = `bilibili-danmaku ${lane}`;
            // 所有弹幕文本只通过 textContent 写入，禁止拼接 HTML。
            span.textContent = item.text;
            span.style.color = normalizeColor(item.color ?? 0xffffff);
            span.style.fontSize = normalizeFontSize(item.fontSize);
            span.style.setProperty('--lane', `${(active.size % LANE_COUNT) * LANE_STEP_PERCENT + LANE_START_PERCENT}%`);
            // 生命周期按视频时间计算：暂停时 currentTime 不前进，弹幕不会过期。
            span._danmakuBorn = video.currentTime || 0;
            span._danmakuLife = item.mode === 1 ? SCROLL_LIFE_SECONDS : FIXED_LIFE_SECONDS;
            active.add(span);
            layer.appendChild(span);
        }

        // 过期删除跟随视频时间，与 CSS 动画时长一致。
        function pruneExpired(now) {
            active.forEach(node => {
                if (now - node._danmakuBorn <= node._danmakuLife) return;
                active.delete(node);
                removeNode(node);
            });
        }

        // 根据当前播放时间定位第一条未来弹幕；找不到则定位到末尾。
        function findCursor(now) {
            const index = items.findIndex(item => item.time > now + SEEK_TOLERANCE_SECONDS);
            return index === -1 ? items.length : index;
        }

        function tick() {
            if (destroyed) return;
            const now = video.currentTime || 0;
            if (resync || now < lastTime || now - lastTime > 2) {
                resync = false;
                clearActive();
                cursor = findCursor(now);
            }
            lastTime = now;
            pruneExpired(now);
            while (cursor < items.length && items[cursor].time <= now + SEEK_TOLERANCE_SECONDS) {
                if (visible) schedule(items[cursor]);
                cursor += 1;
            }
            frame = requestAnimationFrame(tick);
        }

        function startTicking() {
            if (started || destroyed) return;
            started = true;
            frame = requestAnimationFrame(tick);
        }

        fetch(options.url, { credentials: 'same-origin' })
            .then(response => response.json())
            .then(result => {
                if (destroyed) return;
                items = (Array.isArray(result.items) ? result.items : []).sort((a, b) => a.time - b.time);
                startTicking();
            })
            .catch(() => { /* 弹幕失败不影响视频播放。 */ });

        return {
            get visible() { return visible; },
            setVisible(value) {
                visible = value === true;
                layer.style.display = visible ? '' : 'none';
                if (!visible) clearActive();
            },
            destroy() {
                if (destroyed) return;
                destroyed = true;
                cancelAnimationFrame(frame);
                video.removeEventListener('pause', syncPausedClass);
                video.removeEventListener('play', syncPausedClass);
                video.removeEventListener('seeked', markResync);
                clearActive();
                layer.remove();
            }
        };
    }

    window.BilibiliDanmaku = { create };
})();
