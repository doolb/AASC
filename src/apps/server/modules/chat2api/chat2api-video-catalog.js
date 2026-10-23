'use strict';
const { videoError } = require('./chat2api-video-jobs');
// 仅登记已在当前官网公开前端核对的模式；是否有额度仍由账号上游判定，不自动换模型。
const VIDEO_MODELS = Object.freeze([
    { id: 'doubao-video', providerId: 'doubaochat', name: '豆包视频（官网默认）', referenceLimit: 8 },
    { id: 'glm-video', providerId: 'glm', name: '清影（官网默认）', referenceLimit: 2 },
    { id: 'qwen-happyhorse', providerId: 'qwen', name: 'HappyHorse 1.1', upstream: 'happyhorse11', referenceLimit: 9 },
    { id: 'qwen-wan26', providerId: 'qwen', name: 'Wan 2.6', upstream: 'wan26', referenceLimit: 5 },
    { id: 'qwen-wan27', providerId: 'qwen', name: 'Wan 2.7', upstream: 'wan27', referenceLimit: 5 }
].map(Object.freeze));
function resolveVideoModel(id) {
    const model = VIDEO_MODELS.find(model => model.id === id);
    if (!model) throw videoError('video_model_invalid', '请选择有效的生视频模型');
    return model;
}
module.exports = { VIDEO_MODELS, resolveVideoModel };
