'use strict';
const { normalizeOutputVideos } = require('../../../../core/utils/chat-output-videos');
// ext中的任务ID超过安全整数范围，先保留字符串；普通JSON字符串内的内容不参与替换。
const creationRecord = value => {
    if(typeof value!=='string')return value||{};
    try{return JSON.parse(value.replace(/("(?:\\.|[^"\\])*")|([:\[,]\s*)(-?\d{16,})(?=\s*[,}\]])/g,(_m,text,prefix,digits)=>text||prefix+JSON.stringify(digits)))}catch{return {}}
};
const list = value => Array.isArray(value) ? value : [];
const decode = value => {
    if (typeof value !== 'string') return '';
    try { const url = Buffer.from(value, 'base64').toString(); return /^https:\/\//.test(url) ? url : ''; } catch { return ''; }
};

/** 只进入明确的视频作品/卡片，封面、搜索结果以及图片作品不会被当成视频。 */
function inspectNativeVideos(providerId, data = {}, scope = {}) {
    const videos = []; let started = false; let taskId; let failure; let pending = false;
    const take = value => {
        if (!value || typeof value !== 'object') return;
        const model = typeof value.video_model === 'string' ? (() => { try { return JSON.parse(value.video_model); } catch { return {}; } })() : value.video_model;
        const encoded = Object.values(model?.video_list || {})[0]?.main_url;
        const url = value.video_url || value.download_url || value.play_url || value.playUrl || value.video_ori?.url || value.url || decode(encoded);
        if (typeof url === 'string' && /^https:\/\//.test(url)) videos.push({ url, posterUrl: value.cover_url || value.cover?.url || value.cover_image?.url || value.cover_image?.image_ori?.url || value.poster_url,
            duration: value.duration, width: value.width, height: value.height });
        taskId ||= value.task_id || value.chat_id;
    };
    if (providerId === 'qwen') for (const message of list(data.data?.messages || data.messages)) {
        for (const card of list(message.meta_data?.multi_load)) {
            if (!['ai_generate_video', 'ai_generate_video_loading', 'ai_generate_video_list'].includes(card?.type)) continue;
            started = true; let content = card.content || {};
            if(typeof content==='string'){try{content=JSON.parse(content)}catch{content={}}}
            taskId ||= content.task_id;
            if (['failed', 'error'].includes(content.status)) failure = '千问视频生成失败';
            const complete=['complete','completed','success','succeeded'].includes(content.status||message.status)&&card.type!=='ai_generate_video_loading';
            pending ||= !complete;
            const scan = (value, depth = 0) => {
                if (!value || typeof value !== 'object' || depth > 8) return;
                if (value.video_url || value.download_url || value.play_url || value.video_ori || /\.(mp4|webm)(?:\?|$)/i.test(value.url || '') || value.type === 'video') take(value);
                for (const [key,child] of Object.entries(value)) {
                    if(/cover|poster|thumbnail/i.test(key))continue;
                    if (Array.isArray(child)) child.forEach(item => scan(item, depth + 1));
                    else if (child && typeof child === 'object') scan(child, depth + 1);
                }
            };
            if(complete)scan(content);
        }
    }
    if (providerId === 'glm') for (const part of list(data.parts)) for (const content of list(part?.content)) {
        if (!['video', 'video_generation'].includes(content?.type)) continue;
        started = true; taskId ||= content.task_id || content.chat_id;
        for (const video of list(content.video || content.videos)) take(video);
        if (typeof content.video === 'object' && !Array.isArray(content.video)) take(content.video);
    }
    if (providerId === 'doubaochat') {
        const ext=data.message?.ext||data.ext||{};
        const tools=list(creationRecord(ext.ai_creation_tool_list)).filter(tool=>/^(image|text|video)_to_video$/.test(tool.tool_name||'')||tool.task_type===6);
        const materials=creationRecord(ext.creation_material_info);
        const matched=tools.filter(tool=>(!scope.messageId||list(tool.based_message_id_list).map(String).includes(String(scope.messageId)))
            &&(!scope.taskId||String(tool.task_id)===String(scope.taskId)));
        if(matched.length){
            started=true;
            for(const tool of matched){
                taskId||=String(tool.task_id);
                if(Number(tool.fail_code)>0)failure='豆包视频任务生成失败';
                const material=materials[String(tool.task_id)];
                if(material?.result?.video)take(material.result.video);else pending=true;
            }
        }

        const blocks = [data.block, ...list(data.content_block), ...list(data.message?.content_block),
            ...list(data.content?.content_block), ...list(data.patch_op).flatMap(patch => list(patch?.patch_value?.content_block))];
        for (const block of blocks) for (const item of list(block?.content?.creation_block?.creations)) {
            if (!item?.video) continue;
            started = true; take(item.video);
        }
        if (Number(data.message?.content_type || data.content_type) === 2021) {
            started = true;
            let content = data.message?.content || data.content;
            if (typeof content === 'string') { try { content = JSON.parse(content); } catch { content = {}; } }
            for (const video of list(content?.data)) take(video);
        }
        if (started) taskId ||= data.fin_reason?.async_task?.id;
    }
    return { started, pending, videos: normalizeOutputVideos(videos), ...(taskId ? { taskId: String(taskId) } : {}), ...(failure ? { error: failure } : {}) };
}
module.exports = { inspectNativeVideos, creationRecord };
