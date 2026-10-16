'use strict';

const path = require('node:path');
const { DEFAULT_ROOT_DIR } = require('./chat2api-data-store');
const { createDoubaoSpeechQueue } = require('./chat2api-doubao-speech-queue');

// 对应.src/framework/tts-provider-configuration.md：由应用持有，聊天与代理注入共享准入队列，不使用进程全局单例。
function createSpeechUpstreamController({ getDoubaoConcurrency } = {}) {
    const queue = createDoubaoSpeechQueue({ getConcurrency: getDoubaoConcurrency });
    return {
        forRoot(rootDir) {
            const root = path.resolve(rootDir || DEFAULT_ROOT_DIR);
            return { acquire: (accountId, context) => queue.acquire(JSON.stringify([root, accountId]), context) };
        },
        refresh: () => queue.refresh()
    };
}

module.exports = { createSpeechUpstreamController };
