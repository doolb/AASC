'use strict';

// 生图目录独立于聊天档位；只登记已确认的官网模式，不自动升级付费模型。
const IMAGE_MODELS = Object.freeze([
    { id: 'glm-image-fast', providerId: 'glm', name: '快速', referenceLimit: 1, upstream: '' },
    { id: 'glm-image', providerId: 'glm', name: 'GLM Image', referenceLimit: 0, upstream: 'glm_image' },
    { id: 'seedream-5.0-flash', providerId: 'doubaochat', referenceLimit: 8, name: 'Seedream 5.0 Flash', upstream: 'Seedream 5.0 Flash' },
    { id: 'seedream-4.5', providerId: 'doubaochat', referenceLimit: 8, name: 'Seedream 4.5', upstream: 'Seedream 4.5' },
    { id: 'seedream-4.0', providerId: 'doubaochat', referenceLimit: 8, name: 'Seedream 4.0', upstream: 'Seedream 4.0' },
    { id: 'qwen-image', providerId: 'qwen', name: '千问创意生图', referenceLimit: 2, upstream: 'qwen_image_2' }
].map(Object.freeze));
const imageError = (code, message, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
function resolveImageModel(id) {
    const model = IMAGE_MODELS.find(item => item.id === id);
    if (!model) throw imageError('image_model_invalid', '请选择有效的生图模型');
    return model;
}
module.exports = { IMAGE_MODELS, resolveImageModel, imageError };
