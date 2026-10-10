'use strict';
const path = require('node:path');
const { stageVendor } = require('./mmd-mpl-assets');

// 将校验后的编译器放到正式同源静态目录；服务代码包直接包含这些运行资源。
stageVendor(path.resolve(__dirname, '../../src/apps/web-mediacenter/ui/public')).then(vendor => {
  process.stdout.write(`[mmd-mpl] 正式静态资源已校验并准备：${vendor}\n`);
}).catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
