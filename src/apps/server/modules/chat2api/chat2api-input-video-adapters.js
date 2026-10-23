'use strict';
const { collectVideos } = require('./chat2api-content');
const { uploadGlmImage } = require('./chat2api-image-upload');
const { applicationError } = require('./chat2api-system-controls');

/** 只接收文件缓存ID，沿原账号上传原始视频；不抓取任意URL或用封面代替视频。 */
async function uploadInputVideos({ providerId, request, http, headers, signal, readVideoFile }) {
    const ids = collectVideos(request.messages);
    if (!ids.length) return [];
    if (!readVideoFile || providerId !== 'glm') throw applicationError('unsupported_modality', '当前网页Provider尚未支持原始视频附件');
    if (ids.length > 4) throw applicationError('invalid_input', '单次最多上传4个视频，请减少历史上下文');
    const uploaded = [];
    for (const id of ids) {
        signal?.throwIfAborted(); const file = await readVideoFile(id);
        const result = await uploadGlmImage(file, { http, headers, signal });
        uploaded.push({ file_name: result.file_name, file_id: result.file_id, file_url: result.image_url, file_size: result.file_size, order: uploaded.length });
    }
    return uploaded;
}
module.exports = { uploadInputVideos };
