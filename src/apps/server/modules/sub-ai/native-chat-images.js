'use strict';
const { normalizeOutputImages } = require('../../../../core/utils/chat-output-images');

/** 主模型图片和最终文字共用一个回复记录；下载可继续更新占位，删除后的记录绝不重建。 */
function createNativeChatImages({ chat, assets, scope, requestId, publish, controllers = new Map(), isCurrent = () => true }) {
    const controller = new AbortController();
    const seen = new Set();
    const images = [];
    let record;
    let queue = Promise.resolve();
    let finished = false;
    let settled = false;
    let failure = '';
    let finalFields = {};
    const write = patch => {
        if (!record || !isCurrent()) return null;
        const updated = chat.updateMessage(record.id, patch);
        if (updated) { record = updated; publish(updated); }
        return updated;
    };
    const finalize = () => {
        if (!record || !finished || settled) return;
        const status = controller.signal.aborted ? 'cancelled' : failure ? 'failed' : 'completed';
        const notice = status === 'cancelled' ? '图片生成已取消'
            : failure ? `图片保存失败：${failure}` : `已生成 ${images.length} 张图片`;
        write({ ...finalFields, images: [...images],
            content: finalFields.content ? `${finalFields.content}${status === 'completed' ? '' : `\n${notice}`}` : notice,
            imageGeneration: { source: 'main', requestId, status, ...(failure ? { error: failure } : {}) } });
        settled = true;
        controllers.delete(record.id);
    };
    controller.signal.addEventListener('abort', () => { finished = true; finalize(); }, { once: true });
    return {
        signal: controller.signal,
        isCurrent,
        hasRecord: () => Boolean(record),
        receive(event) {
            if (settled || controller.signal.aborted) return;
            // 首张图片可能在用户清空之后才到达；此时尚无占位ID，仍须通过原用户消息阻止重建。
            if (!isCurrent()) { controller.abort(); return; }
            if (!record) {
                record = chat.addMessage({ ...scope, role: 'assistant', content: '正在生成图片…', images: [],
                    imageGeneration: { source: 'main', requestId, status: 'pending' } });
                controllers.set(record.id, controller);
                publish(record);
            }
            for (const image of normalizeOutputImages(event.images)) {
                const key = image.url || image.dataUrl;
                if (seen.has(key)) continue;
                seen.add(key);
                queue = queue.then(async () => {
                    if (controller.signal.aborted) return;
                    try {
                        const saved = await assets.save(image, { signal: controller.signal });
                        if (controller.signal.aborted) return;
                        images.push(saved);
                        write({ images: [...images] });
                    } catch (error) { failure = error.message; }
                });
            }
        },
        complete(fields) {
            if (!record) return null;
            finalFields = fields;
            if (settled) return record;
            // 先保存正文；下载结束后再置完成，chatResponse不会先于文字关联而生成第二个AI气泡。
            const updated = write(fields);
            finished = true;
            queue = queue.then(() => {
                if (!images.length && !failure) failure = '上游没有返回可保存的图片';
                finalize();
            });
            return updated;
        },
        fail(error) {
            if (!record || settled) return;
            failure = String(error?.message || error || '上游图片生成失败');
            finished = true;
            queue = queue.then(finalize);
        },
        async wait() { await queue; },
    };
}

module.exports = { createNativeChatImages };
