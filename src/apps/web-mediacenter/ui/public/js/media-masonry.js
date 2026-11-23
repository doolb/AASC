/* 媒体库的图片/视频尺寸异步到达；统一批量调整跨度，避免固定行高造成空白。 */
(() => {
    'use strict';

    const lists = [...document.querySelectorAll('#panel-media .media-library-content, #panel-media .bilibili-video-list')];
    const cards = '.media-library-item, .bilibili-video-card';
    const ratios = new WeakMap();
    const dirty = new Set();
    let frame = 0;
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
        for (const entry of entries) {
            const list = entry.target.matches('.media-masonry-ready') ? entry.target : entry.target.parentElement;
            if (list?.classList.contains('media-masonry-ready')) schedule(list);
        }
    }) : null;

    function schedule(list) {
        dirty.add(list);
        if (!frame) frame = requestAnimationFrame(flush);
    }

    function flush() {
        frame = 0;
        const pending = [...dirty];
        dirty.clear();
        for (const list of pending) {
            if (!list.isConnected || !list.clientWidth) continue;
            const style = getComputedStyle(list);
            const columns = style.gridTemplateColumns.split(' ').filter(Boolean).length;
            const row = parseFloat(style.gridAutoRows) || 4;
            const gap = parseFloat(style.rowGap) || 0;
            const children = [...list.children];
            // 先写入列跨度，再统一读取真实高度；DOM 内容和字体变化也会触发 ResizeObserver。
            for (const child of children) {
                const card = child.matches(cards);
                child.classList.toggle('masonry-full', !card);
                child.classList.toggle('masonry-wide', card && columns > 1 && (ratios.get(child) || 0) >= 1.35);
            }
            const measures = children.map(child => [child, child.getBoundingClientRect().height]);
            for (const [child, height] of measures) {
                if (!height) continue;
                const rows = Math.max(1, Math.ceil((height + gap) / (row + gap)));
                if (child.style.getPropertyValue('--masonry-rows') !== String(rows)) child.style.setProperty('--masonry-rows', rows);
            }
        }
    }

    function updateMedia(element) {
        const list = element.closest('.media-masonry-ready');
        const card = element.closest(cards);
        if (!list || !card || card.parentElement !== list) return;
        const width = element instanceof HTMLVideoElement ? element.videoWidth : element.naturalWidth;
        const height = element instanceof HTMLVideoElement ? element.videoHeight : element.naturalHeight;
        if (width > 0 && height > 0) {
            const ratio = width / height;
            ratios.set(card, ratio);
            card.style.setProperty('--media-aspect', `${width} / ${height}`);
        } else {
            ratios.delete(card);
            card.style.removeProperty('--media-aspect');
        }
        schedule(list);
    }

    for (const list of lists) {
        list.classList.add('media-masonry-ready');
        observer?.observe(list);
        const watch = node => {
            if (!(node instanceof Element)) return;
            observer?.observe(node);
            node.querySelectorAll('img, video').forEach(media => {
                if (media instanceof HTMLImageElement && media.complete) updateMedia(media);
                if (media instanceof HTMLVideoElement && media.readyState >= 1) updateMedia(media);
            });
        };
        for (const child of list.children) watch(child);
        new MutationObserver(records => {
            for (const record of records) {
                record.removedNodes.forEach(node => { if (node instanceof Element) observer?.unobserve(node); });
                record.addedNodes.forEach(watch);
            }
            schedule(list);
        }).observe(list, { childList: true });
        list.addEventListener('load', event => { if (event.target.matches('img')) updateMedia(event.target); }, true);
        list.addEventListener('loadedmetadata', event => { if (event.target.matches('video')) updateMedia(event.target); }, true);
        list.addEventListener('error', event => { if (event.target.matches('img, video')) updateMedia(event.target); }, true);
        schedule(list);
    }
    window.addEventListener('resize', () => lists.forEach(schedule));
})();
