'use strict';

/** 每个聊天请求持有自己的分流器；后续动作子AI可单独注册，不共享图像模型。 */
function createSubAiTaskService({ chat, generate, assets, scope, publish, controllers = new Map(), workers = {} }) {
    const registry = new Map(Object.entries(workers));
    const pending = new Set();
    registry.set('生图', async (call, context) => {
        const record = chat.addMessage({ ...scope, role: 'assistant', name: '生图', content: '正在生成图片…',
            imageGeneration: { status: 'pending', prompt: call.prompt }, images: [] });
        publish(record);
        const controller = new AbortController();
        controllers.set(record.id, controller);
        const signal = context.signal ? AbortSignal.any([context.signal, controller.signal]) : controller.signal;
        const job = (async () => {
            const images = [];
            try {
                signal.throwIfAborted();
                if (call.error) throw new Error(call.error);
                const references = await Promise.all(call.references.map(id => {
                    const image = context.references.find(item => item.id === id);
                    if (!image) throw new Error(`当前聊天没有参考图 ${id}`);
                    return assets.read(image);
                }));
                const result = await generate({ prompt: call.prompt, references }, { signal });
                signal.throwIfAborted();
                for (const image of result.data) images.push(await assets.save(image, { signal }));
                signal.throwIfAborted();
                if (!images.length) throw new Error('生图服务没有返回图片');
                const updated = chat.updateMessage(record.id, { content: `已生成 ${images.length} 张图片`, images,
                    imageGeneration: { ...record.imageGeneration, status: 'completed' } });
                if (updated) publish(updated);
            } catch (error) {
                const status = signal.aborted ? 'cancelled' : 'failed';
                const updated = chat.updateMessage(record.id, { images, content: status === 'cancelled' ? '图片生成已取消' : `图片生成失败：${error.message}`,
                    imageGeneration: { ...record.imageGeneration, status, error: error.message } });
                if (updated) publish(updated);
            }
        })();
        pending.add(job); job.finally(() => { pending.delete(job); controllers.delete(record.id); });
    });
    return {
        async dispatch(call, context) {
            const worker = registry.get(call.task || '生图');
            if (!worker) {
                await registry.get('生图')({ ...call, error: `不支持的 SubAI 任务：${call.task}` }, context);
                return;
            }
            await worker(call, context);
        },
        async wait() { await Promise.allSettled([...pending]); }
    };
}
module.exports = { createSubAiTaskService };
