'use strict';
const { createGlmAuthHeaders } = require('./chat2api-glm-auth');
const { imageError } = require('./chat2api-image-catalog');

/** 参考图片使用官网文件上传接口，再调用独立智能编辑接口。 */
async function generateGlmReference(image, { http, headers, signal, prompt, ratio }) {
    const file = await uploadGlmImage(image, { http, headers, signal, assistantId: '65a232c082ff90a2ad2f15e2' });
    const result = await http.post('https://chatglm.cn/chatglm/drawing-api/v1/image/reference', {
        image_url: file.image_url, file_id: '', type: 'Intelligent Editing', category: 1,
        conversation_id: '', history_id: '', assistant_id: '65a232c082ff90a2ad2f15e2',
        prompt, if_plus_model: false, title: `【智能编辑】 ${prompt}`, aspect_ratio: ratio || '1:1', rm_label_watermark: false
    }, { headers: { ...headers, ...createGlmAuthHeaders() }, signal, timeout: 90000 });
    const url = result.data?.result?.image_url;
    if (result.data?.status !== 0 || typeof url !== 'string' || !url.startsWith('https://')) throw imageError('glm_reference_failed', 'GLM 参考图生成失败', 502);
    return [{ url }];
}
async function uploadGlmImage(image, { http, headers, signal, assistantId = '65940acff94777010aa6b796' }) {
    const form = new FormData();
    form.append('file', new Blob([image.data], { type: image.mimeType }), image.filename || 'reference.png');
    form.append('from', 'chat'); form.append('assistant_id', assistantId);
    const upload = await http.post('https://chatglm.cn/chatglm/productivity-api/file/chat_upload', form, {
        headers: { ...headers, ...createGlmAuthHeaders() }, signal, timeout: 60000 });
    const file = upload.data?.result;
    if (upload.data?.status !== 0 || !file?.file_url) throw imageError('glm_upload_failed', 'GLM 参考图上传失败', 502);
    if (!file.file_id) throw imageError('glm_upload_failed', 'GLM 图片上传未返回文件标识', 502);
    return { file_name: file.file_name || image.filename, file_id: file.file_id, image_url: file.file_url,
        file_size: file.file_size || image.data.length, order: 0, width: 0, height: 0 };
}
module.exports = { generateGlmReference, uploadGlmImage };
