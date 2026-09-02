'use strict';

const { createVisionTask } = require('./vision-task-client');

module.exports = createVisionTask({
    id: 'yolo',
    name: 'YOLO11n 目标检测',
    description: '通过服务器路由请求显示端 NativeDisplay 执行 YOLO11n',
    path: '/api/vision/yolo'
});
