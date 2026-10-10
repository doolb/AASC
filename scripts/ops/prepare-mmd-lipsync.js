'use strict';
const path = require('node:path');
const { stageVendor } = require('./mmd-lipsync-assets');
// 正式静态资源随服务代码包分发，运行时只从本地同源按需加载。
stageVendor(path.resolve(__dirname, '../../src/apps/web-mediacenter/ui/public')).then(vendor => {
    process.stdout.write(`[mmd-lipsync] 正式拼音资源已准备：${vendor}\n`);
}).catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
