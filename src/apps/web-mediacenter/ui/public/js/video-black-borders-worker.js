/* 网页Worker与Node线程执行同一检测器，仅返回当前帧候选，不直接修改播放布局。 */
(function() {
    'use strict';
    const isNode = typeof module === 'object' && module.exports;
    let api, port;
    if (isNode) {
        api = require('./video-black-borders');
        port = require('node:worker_threads').parentPort;
    } else {
        importScripts('video-black-borders.js');
        api = self.VideoBlackBorders; port = self;
    }
    const handle = frame => {
        try {
            port.postMessage({ id: frame.id, rect: api.detectFrame(frame) });
        } catch (error) { port.postMessage({ id: frame.id, error: error.message }); }
    };
    if (isNode) port.on('message', handle);
    else port.addEventListener('message', event => handle(event.data));
})();
