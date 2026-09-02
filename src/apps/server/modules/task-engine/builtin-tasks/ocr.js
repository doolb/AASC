'use strict';

const { createVisionTask } = require('./vision-task-client');

module.exports = createVisionTask({
    id: 'ocr',
    name: 'OCR 文字识别',
    description: '通过服务器路由请求显示端 NativeDisplay 执行 RapidOCR',
    path: '/api/vision/ocr',
    extraParams: [
        {
            name: 'shortSide',
            type: 'select',
            required: false,
            default: 0,
            options: [0, 736, 512, 384],
            label: 'OCR 图片短边上限（0=自动）'
        }
    ]
});
