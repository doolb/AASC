'use strict';
const { inspectNativeVideos } = require('./chat2api-native-videos');
const { mergeOutputVideos } = require('../../../../core/utils/chat-output-videos');
const { mergeOutputImages } = require('../../../../core/utils/chat-output-images');

/** 原生视频状态单独收集；已有任务只登记查询，不在聊天流中等待整个视频生成。 */
function createNativeVideoStream(providerId, options) {
    let videos = []; let started = false; let taskId; let pending = false; let finished = false;
    return {
        push(data) {
            if (providerId === 'glm' && data.status === 'finish') finished = true;
            const state = inspectNativeVideos(providerId, data);
            if (state.error) throw Object.assign(new Error(state.error), { code: 'video_generation_failed', statusCode: 502 });
            if (!state.started) return null;
            videos = mergeOutputVideos(videos, state.videos); pending = state.pending; taskId ||= state.taskId;
            if (started) return null;
            started = true; return { video_generation: { status: 'pending' } };
        },
        async finish() {
            if (!started) return null;
            if (providerId === 'glm' && videos.length && !finished) throw Object.assign(new Error('视频回复流提前结束'), { code: 'video_stream_interrupted', statusCode: 502 });
            let generation = { status: videos.length && !pending ? 'completed' : 'pending' };
            if ((!videos.length || pending) && options.adoptVideoTask) {
                const upstream = providerId === 'qwen'
                    ? { sessionId: options.prepared?.data.session_id, reqId: options.prepared?.data.req_id, parentReqId: options.prepared?.data.parent_req_id }
                    : taskId ? { taskId } : null;
                if (upstream && (upstream.taskId || upstream.sessionId && upstream.reqId)) {
                    const job = await options.adoptVideoTask({ providerId, account: options.account, upstream });
                    generation.taskId = job.id;
                }
            }
            if ((!videos.length || pending) && !generation.taskId) generation = { status: 'failed', error: '上游未返回可查询的视频任务' };
            return { videos, video_generation: generation };
        }
    };
}

/** 非流式也消费同一条媒体流，正文和多媒体的完成语义只维护一份。 */
async function collectNativeMediaBody(parseStream, createBody, source, model, providerId, headers, responseSession, options) {
    let content = ''; let id; let images = []; let videos = []; let generation;
    for await (const chunk of parseStream(source, model, providerId, headers, responseSession, options)) {
        id = chunk.id || id;
        const delta = chunk.choices?.[0]?.delta || {};
        content += delta.content || '';
        images = mergeOutputImages(images, delta.images || []);
        videos = mergeOutputVideos(videos, delta.videos || []);
        if (delta.video_generation) generation = delta.video_generation;
    }
    const body = createBody(content.trim(), model, id, images);
    if (videos.length) body.choices[0].message.videos = videos;
    if (generation) body.choices[0].message.video_generation = generation;
    return body;
}
module.exports = { createNativeVideoStream, collectNativeMediaBody };
