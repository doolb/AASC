'use strict';
// 管道守卫：以 O_RDWR 打开 in.fifo 并一直持有写端。
// 服务器退出时服务器持有的写端关闭，若无人持有写端，claude 的 stdin 会读到 EOF 而退出；
// 守卫持有写端 → claude stdin 永不 EOF → 服务器重启期间 claude 进程不中断。
// O_RDWR 打开不阻塞（Linux FIFO），无需等待读者即可立即持有写端。
const fs = require('node:fs');
const [,, inFifo, pidFile] = process.argv;

const fd = fs.openSync(inFifo, 'r+'); // 持有写端（r+ = O_RDWR）
fs.writeFileSync(pidFile, String(process.pid));

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
setInterval(() => {}, 1 << 30); // 保持事件循环存活（fd 由模块级 const 引用，不会 GC）
