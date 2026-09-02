'use strict';

const { createVisionTask } = require('./vision-task-client');

module.exports = createVisionTask({
    id: 'ocr',
    name: 'OCR 文字识别',
    description: '通过服务器路由请求显示端 NativeDisplay 执行 RapidOCR',
    path: '/api/vision/ocr'
});
