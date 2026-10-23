'use strict';

/** 仅用于明确的视频结果字段，不扫描普通正文链接。 */
function normalizeOutputVideos(input = []) {
    if (!Array.isArray(input)) return [];
    const result = new Map();
    for (const item of input) {
        const source = typeof item === 'string' ? { url: item } : item;
        const url = source?.url || source?.video_url?.url || source?.video_url;
        if (typeof url !== 'string' || !/^https:\/\/[^\s]+$/.test(url) || url.length > 16384) continue;
        const video = { url };
        const poster = source.posterUrl || source.cover_url || source.cover;
        if (typeof poster === 'string' && /^https:\/\//.test(poster)) video.posterUrl = poster;
        for (const key of ['width', 'height', 'duration']) if (Number.isFinite(Number(source[key])) && Number(source[key]) > 0) video[key] = Number(source[key]);
        result.set(url, { ...result.get(url), ...video });
    }
    return [...result.values()];
}
const mergeOutputVideos = (...groups) => normalizeOutputVideos(groups.flat());
function extractOutputVideos(message) {
    if (!message || typeof message !== 'object') return [];
    const result = [...(Array.isArray(message.videos) ? message.videos : [])];
    for (const part of Array.isArray(message.content) ? message.content : []) {
        if (['output_video', 'video_url', 'video'].includes(part?.type)) result.push(part);
    }
    for (const item of Array.isArray(message.output) ? message.output : []) result.push(...extractOutputVideos(item));
    return normalizeOutputVideos(result);
}
function createOutputVideoCollector(onVideos) {
    let videos = []; let generation = {}; let signature = '';
    const push = (incoming, update = {}) => {
        videos = mergeOutputVideos(videos, incoming); generation = { ...generation, ...update };
        const current = JSON.stringify({ videos, generation });
        if (current === signature) return;
        signature = current;
        onVideos?.({ videos: [...videos], ...generation });
    };
    return {
        pushMessage(message) {
            const incoming = extractOutputVideos(message);
            if (message?.video_generation || incoming.length) push(incoming, message.video_generation || { status: 'completed' });
        },
        pushEvent(event) {
            if (event?.type === 'response.output_videos') push(event.videos || [], event.generation || { status: event.status || 'pending' });
            if (event?.type === 'response.output_item.done') this.pushMessage(event.item);
            if (event?.type === 'response.completed') this.pushMessage(event.response);
        },
        getVideos: () => [...videos],
        getGeneration: () => ({ ...generation })
    };
}
module.exports = { normalizeOutputVideos, mergeOutputVideos, extractOutputVideos, createOutputVideoCollector };
