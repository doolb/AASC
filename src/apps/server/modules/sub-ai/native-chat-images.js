'use strict';
const { normalizeOutputImages } = require('../../../../core/utils/chat-output-images');
const { normalizeOutputVideos } = require('../../../../core/utils/chat-output-videos');

/** 图片、视频与文字共用原回复；每种媒体独立排队，视频不会拖住聊天和TTS收尾。 */
function createNativeChatImages({ chat, assets, videoAssets, waitVideo, scope, requestId, publish,
    controllers = new Map(), isCurrent = () => true, existingRecord }) {
    const controller = new AbortController();
    let record = existingRecord; let finished = false; let finalFields = {};
    const groups = {
        image: { key: 'images', generation: 'imageGeneration', label: '图片', active: false, settled: false,
            values: [], seen: new Set(), queue: Promise.resolve(), normalize: normalizeOutputImages, assets },
        video: { key: 'videos', generation: 'videoGeneration', label: '视频', active: false, settled: false,
            values: [...(existingRecord?.videos || [])], seen: new Set(), tasks: new Set(), queue: Promise.resolve(), normalize: normalizeOutputVideos, assets: videoAssets }
    };
    const write = patch => {
        if (!record || !isCurrent()) return null;
        const updated = chat.updateMessage(record.id, patch);
        if (updated) { record = updated; publish(updated); }
        return updated;
    };
    const finalize = group => {
        if (!record || !finished || group.settled) return;
        const status = controller.signal.aborted ? 'cancelled' : group.failure ? 'failed' : 'completed';
        const notice = status === 'cancelled' ? `${group.label}生成已取消`
            : group.failure ? `${group.label}保存失败：${group.failure}` : `已生成 ${group.values.length} ${group === groups.image ? '张图片' : '个视频'}`;
        const old = record[group.generation] || {};
        write({ ...finalFields, [group.key]: [...group.values],
            content: finalFields.content ? `${finalFields.content}${status === 'completed' ? '' : `\n${notice}`}` : notice,
            [group.generation]: { ...old, source: old.source || 'main', requestId, status, ...(group.failure ? { error: group.failure } : {}) } });
        group.settled = true;
        if (Object.values(groups).every(item => !item.active || item.settled)) controllers.delete(record.id);
    };
    const save = async (group, incoming) => {
        for (const value of group.normalize(incoming)) {
            const key = value.url || value.dataUrl;
            if (group.seen.has(key)) continue;
            group.seen.add(key); controller.signal.throwIfAborted();
            if (!group.assets) throw new Error(`${group.label}本地存储不可用`);
            try {
                const saved = await group.assets.save(value, { signal: controller.signal });
                controller.signal.throwIfAborted();
                if (!isCurrent()) return;
                group.values.push(saved); write({ [group.key]: [...group.values] });
            } catch(error) {
                if(controller.signal.aborted)throw error;
                group.failure=error.message;
            }
        }
    };
    const receive = (group, event) => {
        if (group.settled || controller.signal.aborted) return;
        if (!isCurrent()) { controller.abort(); return; }
        group.active = true;
        const metadata = { ...(record?.[group.generation] || {}), source: record?.[group.generation]?.source || 'main', requestId, status: 'pending',
            ...(event.taskId ? { taskId: event.taskId } : {}) };
        if (!record) {
            record = chat.addMessage({ ...scope, role: 'assistant', content: `正在生成${group.label}…`,
                [group.key]: [], [group.generation]: metadata });
            controllers.set(record.id, controller); publish(record);
        } else { controllers.set(record.id, controller); write({ [group.generation]: metadata }); }
        if (event.status === 'failed') group.failure = event.error || `上游${group.label}生成失败`;
        // follow任务和下载均在后台队列，receive立即返回，不占用LLM回复循环。
        group.queue = group.queue.then(async () => {
            try {
                await save(group, event[group.key] || []);
                if (group === groups.video && event.taskId && !group.tasks.has(event.taskId)) {
                    group.tasks.add(event.taskId);
                    if (!waitVideo) throw new Error('视频任务查询不可用');
                    const result = await waitVideo(event.taskId, { signal: controller.signal });
                    await save(group, result.data);
                }
            } catch (error) { group.failure = error.message; }
        });
    };
    controller.signal.addEventListener('abort', () => {
        finished = true;
        for (const group of Object.values(groups)) if (group.active) finalize(group);
    }, { once: true });
    return {
        signal: controller.signal, isCurrent, hasRecord: () => Boolean(record),
        receive: event => receive(groups.image, event),
        receiveVideos: event => receive(groups.video, event),
        complete(fields) {
            if (!record) return null;
            finalFields = fields; const updated = write(fields); finished = true;
            for (const group of Object.values(groups)) if (group.active && !group.settled) {
                group.queue = group.queue.then(() => {
                    if (!group.values.length && !group.failure) group.failure = `上游没有返回可保存的${group.label}`;
                    finalize(group);
                });
            }
            return updated;
        },
        fail(error) {
            if (!record) return;
            finished = true;
            for (const group of Object.values(groups)) if (group.active && !group.settled) {
                group.failure = String(error?.message || error || '上游媒体生成失败');
                group.queue = group.queue.then(() => finalize(group));
            }
        },
        async wait() { await groups.image.queue; },
        async waitAll() { await Promise.all(Object.values(groups).map(group => group.queue)); }
    };
}
module.exports = { createNativeChatImages };
