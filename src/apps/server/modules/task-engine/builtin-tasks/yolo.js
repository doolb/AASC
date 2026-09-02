'use strict';

const { createVisionTask } = require('./vision-task-client');

module.exports = createVisionTask({
    id: 'yolo',
    name: 'YOLO11 目标检测',
    description: '通过服务器路由请求显示端 NativeDisplay 执行可选 YOLO11 模型',
    path: '/api/vision/yolo',
    extraParams: [
        {
            name: 'model',
            type: 'select',
            required: false,
            default: 'yolo11n',
            options: ['yolo11n', 'yolo11s', 'yolo11m', 'yolo11l', 'yolo11x'],
            label: 'YOLO 模型'
        }
    ]
});
