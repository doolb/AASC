'use strict';
const { randomUUID } = require('node:crypto');
const { collectImages } = require('./chat2api-content');
const { applicationError } = require('./chat2api-system-controls');
const LIMIT = 20 * 1024 * 1024;

/** AASC把本地图读成Data URL；Native入口只接收图片字节，明确拒绝无法上传的链接。 */
function decodeChatImage(url) {
    const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
    if (!match) throw applicationError('invalid_input', '网页Provider图片请使用Data URL，不能使用文本中的图片链接');
    const data = Buffer.from(match[2], 'base64');
    if (!data.length || data.length > LIMIT || data.toString('base64').replace(/=+$/, '') !== match[2].replace(/=+$/, '')) {
        throw applicationError('invalid_input', '图片数据无效或超过20MiB');
    }
    const mimeType = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
    return { data, mimeType, filename: `image.${mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1]}` };
}
function readChatImages(request) {
    const urls = [...new Set(collectImages(request.messages))];
    if (urls.length > 32) throw applicationError('invalid_input', '单次图片数量不能超过32张');
    // 先检查编码体积，避免一次性解码多张大图后才发现超出总量。
    if (urls.reduce((sum,url)=>sum+url.length,0)>Math.ceil(40*1024*1024/3)*4+2048) throw applicationError('invalid_input','单次图片总大小不能超过40MiB');
    const images = urls.map(decodeChatImage);
    if (images.reduce((sum,image)=>sum+image.data.length,0)>40*1024*1024) throw applicationError('invalid_input','单次图片总大小不能超过40MiB');
    return images;
}
function doubaoAttachmentMessage(files) {
    return { local_message_id: randomUUID(), message_status: 0, content_block: [{ block_type: 10052,
        content: { attachment_block: { attachments: files.map(file => ({ type: 1, identifier: randomUUID(),
            image: { name: file.name, uri: file.uri, image_ori: { url: '', width: file.width || 0, height: file.height || 0,
                format: file.format, url_formats: {} } }, parse_state: 0, review_state: 1, upload_status: 1, progress: 100, src: '' })) }, pc_event_block: '' },
        block_id: randomUUID(), parent_id: '', meta_info: [], extra_info: {}, append_fields: [] }] };
}
function qwenImageMessages(files) {
    return files.map(file=>({ mime_type:'image/url',content:'',meta_data:{resource_infos:[{
        id:file.id,url:file.url,file_name:file.file_name,file_format:file.file_format,file_size:String(file.file_size || 0),
        width:file.width || 0,height:file.height || 0 }]},status:'complete' }));
}
module.exports={readChatImages,decodeChatImage,doubaoAttachmentMessage,qwenImageMessages};
