(function(root) {
    'use strict';

    /**
     * 规范化图片地址，过滤空白与无效字符串占位。
     * @param {any} value - 原始地址
     * @returns {string} 有效地址或空字符串
     */
    function normalizeUrl(value) {
        if (typeof value !== 'string') return '';
        const url = value.trim();
        return url && !['null', 'undefined'].includes(url.toLowerCase()) ? url : '';
    }

    /**
     * 从媒体项数据中解析主地址与备用代理地址。
     * @param {object} data - 媒体数据
     * @returns {{directUrl: string, fallbackUrl: string, isBase64: boolean}}
     */
    function resolveSources(data) {
        if (!data || typeof data !== 'object') {
            return { directUrl: '', fallbackUrl: '', isBase64: false };
        }
        if (data.type === 'base64') {
            const mimeType = data.mimeType || 'application/octet-stream';
            return {
                directUrl: data.data ? `data:${mimeType};base64,${data.data}` : '',
                fallbackUrl: '',
                isBase64: true
            };
        }
        return {
            directUrl: normalizeUrl(data.url),
            fallbackUrl: normalizeUrl(data.fallbackUrl),
            isBase64: false
        };
    }

    /**
     * 判断播放列表项是否属于支持预加载与无闪烁切换的图片/GIF。
     * @param {object} item - 列表项或媒体数据
     * @returns {boolean}
     */
    function isImageMediaItem(item) {
        if (!item || typeof item !== 'object') return false;
        const type = item.mediaType || 'image';
        return type === 'image' || type === 'gif';
    }

    /**
     * 将当前正在显示的媒体图片帧绘制到同位过渡垫底画布，避免切 src 期间露出容器背景。
     * @param {HTMLImageElement} imageEl - 当前主图片元素
     * @param {HTMLCanvasElement} holdCanvas - 过渡垫底画布
     * @returns {boolean} 是否成功覆盖垫底画面
     */
    function captureHold(imageEl, holdCanvas) {
        if (!imageEl || !holdCanvas || typeof holdCanvas.getContext !== 'function') return false;
        const naturalWidth = imageEl.naturalWidth || 0;
        const naturalHeight = imageEl.naturalHeight || 0;
        if (naturalWidth <= 0 || naturalHeight <= 0) return false;
        try {
            const computed = typeof getComputedStyle === 'function' ? getComputedStyle(imageEl) : null;
            const boxWidth = imageEl.offsetWidth || parseFloat(computed?.width) || 0;
            const boxHeight = imageEl.offsetHeight || parseFloat(computed?.height) || 0;
            if (boxWidth <= 0 || boxHeight <= 0) return false;

            holdCanvas.width = naturalWidth;
            holdCanvas.height = naturalHeight;
            const ctx = holdCanvas.getContext('2d');
            if (!ctx) return false;
            ctx.clearRect(0, 0, naturalWidth, naturalHeight);
            ctx.drawImage(imageEl, 0, 0, naturalWidth, naturalHeight);

            holdCanvas.style.position = 'absolute';
            holdCanvas.style.left = `${imageEl.offsetLeft || 0}px`;
            holdCanvas.style.top = `${imageEl.offsetTop || 0}px`;
            holdCanvas.style.width = `${boxWidth}px`;
            holdCanvas.style.height = `${boxHeight}px`;
            holdCanvas.style.maxWidth = 'none';
            holdCanvas.style.maxHeight = 'none';
            holdCanvas.style.margin = '0';
            holdCanvas.style.transition = 'none';
            holdCanvas.style.transform = imageEl.style.transform || computed?.transform || '';
            holdCanvas.style.clipPath = imageEl.style.clipPath || computed?.clipPath || '';
            holdCanvas.style.display = 'block';
            return true;
        } catch {
            hideHold(holdCanvas);
            return false;
        }
    }

    /**
     * 隐藏并重置过渡垫底画布。
     * @param {HTMLCanvasElement} holdCanvas - 过渡垫底画布
     */
    function hideHold(holdCanvas) {
        if (!holdCanvas || !holdCanvas.style) return;
        holdCanvas.style.display = 'none';
        holdCanvas.style.transform = '';
        holdCanvas.style.clipPath = '';
        holdCanvas.style.width = '';
        holdCanvas.style.height = '';
        holdCanvas.style.left = '';
        holdCanvas.style.top = '';
    }

    /**
     * 创建显示端图片预加载与双缓冲切换控制器。
     * @param {object} [options]
     * @param {Function} [options.createImage] - 自定义 Image 工厂（便于单元测试注入）
     * @returns {object} 控制器实例
     */
    function createController(options = {}) {
        const createImage = typeof options.createImage === 'function'
            ? options.createImage
            : () => (typeof Image === 'function' ? new Image() : null);

        let currentLoad = null;
        let prefetched = null;

        /**
         * 启动单次图片后台加载，严格按直连优先、失败后回退备用地址执行，并等待解码就绪。
         * @param {string} directUrl - 主地址
         * @param {string} fallbackUrl - 备用代理地址
         * @param {object} handlers - 回调集合
         * @returns {{cancel: Function}} 取消句柄
         */
        function loadImageCandidate(directUrl, fallbackUrl, handlers) {
            const safeDirect = normalizeUrl(directUrl);
            const safeFallback = normalizeUrl(fallbackUrl);
            const firstUrl = safeDirect || safeFallback;
            let cancelled = false;
            let fallbackUsed = false;
            const img = firstUrl ? createImage() : null;

            const cleanupImage = (clearSource) => {
                if (!img) return;
                img.onload = null;
                img.onerror = null;
                if (clearSource) {
                    try {
                        img.src = '';
                    } catch { /* 忽略测试桩或只读属性清理异常 */ }
                }
            };

            const cancel = () => {
                if (cancelled) return;
                cancelled = true;
                cleanupImage(true);
            };

            if (!firstUrl || !img) {
                Promise.resolve().then(() => {
                    if (!cancelled) handlers.onFailure?.();
                });
                return { cancel };
            }

            let activeUrl = firstUrl;
            const finishLoad = () => {
                if (cancelled) return;
                const waitDecode = typeof img.decode === 'function'
                    ? Promise.resolve(img.decode()).catch(() => {})
                    : Promise.resolve();
                waitDecode.then(() => {
                    if (cancelled) return;
                    cleanupImage(false);
                    handlers.onSuccess?.(activeUrl, img);
                });
            };

            img.onload = finishLoad;
            img.onerror = () => {
                if (cancelled) return;
                if (!fallbackUsed && safeFallback && safeFallback !== safeDirect) {
                    fallbackUsed = true;
                    activeUrl = safeFallback;
                    img.src = safeFallback;
                    return;
                }
                cleanupImage(true);
                handlers.onFailure?.();
            };
            img.src = firstUrl;

            return { cancel };
        }

        function buildPrefetchKey(listId, index, directUrl, fallbackUrl) {
            return `${listId || ''}::${index}::${directUrl}::${fallbackUrl}`;
        }

        /**
         * 取消当前正在进行的切图加载（不影响已独立运行的预加载除非显式清理）。
         */
        function cancelCurrentLoad() {
            if (!currentLoad) return;
            const active = currentLoad;
            currentLoad = null;
            active.cancel();
        }

        /**
         * 清理播放列表预加载缓存与在途预加载请求。
         */
        function clearPrefetch() {
            if (!prefetched) return;
            const entry = prefetched;
            prefetched = null;
            entry.waiters.length = 0;
            entry.cancel?.();
        }

        /**
         * 清空全部图片预加载与切图加载状态。
         */
        function reset() {
            cancelCurrentLoad();
            clearPrefetch();
        }

        /**
         * 预加载播放列表下一张图片（含直连失败后回退备用地址）。
         * @param {object} params
         */
        function prefetchNext({ listId, index, item }) {
            if (!isImageMediaItem(item)) return;
            const { directUrl, fallbackUrl, isBase64 } = resolveSources(item);
            if (isBase64 || (!directUrl && !fallbackUrl)) return;

            const key = buildPrefetchKey(listId, index, directUrl, fallbackUrl);
            if (prefetched && prefetched.key === key && prefetched.status !== 'failed') {
                return;
            }

            clearPrefetch();
            const entry = {
                key,
                listId: listId || '',
                index,
                directUrl,
                fallbackUrl,
                status: 'loading',
                resolvedUrl: '',
                img: null,
                waiters: [],
                cancel: null
            };
            prefetched = entry;

            const task = loadImageCandidate(directUrl, fallbackUrl, {
                onSuccess: (resolvedUrl, img) => {
                    if (prefetched !== entry) return;
                    entry.status = 'ready';
                    entry.resolvedUrl = resolvedUrl;
                    entry.img = img;
                    const waiters = entry.waiters.splice(0);
                    waiters.forEach((waiter) => waiter.onSuccess(resolvedUrl, img));
                },
                onFailure: () => {
                    if (prefetched !== entry) return;
                    entry.status = 'failed';
                    const waiters = entry.waiters.splice(0);
                    waiters.forEach((waiter) => waiter.onFailure());
                }
            });
            entry.cancel = task.cancel;
        }

        /**
         * 优先消费匹配的预加载结果，否则在后台加载图片后再回调切图或失败处理。
         * @param {object} params
         */
        function loadForSwap({ listId, index, data, isStale, onReady, onError }) {
            cancelCurrentLoad();
            const staleCheck = typeof isStale === 'function' ? isStale : () => false;
            const { directUrl, fallbackUrl } = resolveSources(data);
            if (!directUrl && !fallbackUrl) {
                Promise.resolve().then(() => {
                    if (!staleCheck()) onError?.();
                });
                return;
            }

            const key = buildPrefetchKey(listId, index, directUrl, fallbackUrl);
            if (prefetched && prefetched.key === key) {
                const entry = prefetched;
                if (entry.status === 'ready') {
                    prefetched = null;
                    let cancelled = false;
                    currentLoad = { cancel: () => { cancelled = true; } };
                    Promise.resolve().then(() => {
                        if (cancelled || staleCheck()) return;
                        currentLoad = null;
                        onReady?.(entry.resolvedUrl, entry.img);
                    });
                    return;
                }
                if (entry.status === 'failed') {
                    prefetched = null;
                    let cancelled = false;
                    currentLoad = { cancel: () => { cancelled = true; } };
                    Promise.resolve().then(() => {
                        if (cancelled || staleCheck()) return;
                        currentLoad = null;
                        onError?.();
                    });
                    return;
                }
                if (entry.status === 'loading') {
                    // 消费命中中的在途预加载条目：等待同一请求完成，避免重复发包。
                    prefetched = null;
                    let cancelled = false;
                    const waiter = {
                        onSuccess: (resolvedUrl, img) => {
                            if (cancelled || staleCheck()) return;
                            currentLoad = null;
                            onReady?.(resolvedUrl, img);
                        },
                        onFailure: () => {
                            if (cancelled || staleCheck()) return;
                            currentLoad = null;
                            onError?.();
                        }
                    };
                    entry.waiters.push(waiter);
                    currentLoad = {
                        cancel: () => {
                            cancelled = true;
                            entry.waiters = entry.waiters.filter((item) => item !== waiter);
                            entry.cancel?.();
                        }
                    };
                    return;
                }
            }

            clearPrefetch();
            let cancelled = false;
            const task = loadImageCandidate(directUrl, fallbackUrl, {
                onSuccess: (resolvedUrl, img) => {
                    if (cancelled || staleCheck()) return;
                    currentLoad = null;
                    onReady?.(resolvedUrl, img);
                },
                onFailure: () => {
                    if (cancelled || staleCheck()) return;
                    currentLoad = null;
                    onError?.();
                }
            });
            currentLoad = {
                cancel: () => {
                    cancelled = true;
                    task.cancel();
                }
            };
        }

        return {
            prefetchNext,
            loadForSwap,
            cancelCurrentLoad,
            clearPrefetch,
            reset,
            getState: () => ({
                hasCurrentLoad: Boolean(currentLoad),
                prefetchedStatus: prefetched ? prefetched.status : null,
                prefetchedIndex: prefetched ? prefetched.index : null
            })
        };
    }

    const api = {
        createController,
        captureHold,
        hideHold,
        isImageMediaItem,
        normalizeUrl,
        resolveSources
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root && typeof root === 'object') {
        root.DisplayImagePreloader = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
