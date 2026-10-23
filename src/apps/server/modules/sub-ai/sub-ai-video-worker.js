'use strict';

/** 指令任务保存独立卡片；收到已知上游任务后只查询，不让主聊天等待整个视频生成。 */
function createSubAiVideoWorker({ chat, assets, imageAssets, createVideo, waitVideo, scope, publish, controllers, pending }) {
    return async (call, context) => {
        const record = chat.addMessage({ ...scope, role: 'assistant', name: '生视频', content: '正在生成视频…', videos: [],
            videoGeneration: { source: 'subai', status: 'pending', prompt: call.prompt } });
        publish(record);
        const controller = new AbortController(); controllers.set(record.id, controller);
        const signal = context.signal ? AbortSignal.any([context.signal, controller.signal]) : controller.signal;
        const job = (async () => {
            const videos = []; let task;
            try {
                signal.throwIfAborted(); if (call.error) throw new Error(call.error);
                const references = await Promise.all(call.references.map(id => {
                    const image = context.references.find(image => image.id === id);
                    if (!image) throw new Error(`当前聊天没有参考图 ${id}`);
                    return imageAssets.read(image);
                }));
                task = await createVideo({ prompt: call.prompt, references });
                signal.throwIfAborted();
                const submitted = chat.updateMessage(record.id, { videoGeneration: { ...record.videoGeneration, taskId: task.id } });
                if (!submitted) { controller.abort(); return; }
                publish(submitted);
                const result = await waitVideo(task.id, { signal });
                let failure;
                for (const video of result.data) {
                    try { videos.push(await assets.save(video,{signal})); } catch(error) { if(signal.aborted)throw error;failure=error; }
                }
                if(failure)throw failure;
                signal.throwIfAborted();
                const updated = chat.updateMessage(record.id, { videos, content: `已生成 ${videos.length} 个视频`,
                    videoGeneration: { ...record.videoGeneration, taskId: task.id, status: 'completed' } });
                if (updated) publish(updated);
            } catch (error) {
                if(signal.aborted&&task?.id)void waitVideo(task.id,{signal}).catch(()=>{});
                const updated = chat.updateMessage(record.id, { videos, content: signal.aborted ? '视频生成已取消' : `视频生成失败：${error.message}`,
                    videoGeneration: { ...record.videoGeneration, status: signal.aborted ? 'cancelled' : 'failed', error: error.message } });
                if (updated) publish(updated);
            }
        })();
        pending.add(job); job.finally(() => { pending.delete(job); controllers.delete(record.id); });
    };
}
module.exports = { createSubAiVideoWorker };
