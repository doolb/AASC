'use strict';

const path = require('path');

/**
 * 创建纯文本分页播放使用的单句 TTS 服务。
 *
 * 每个显示端维护独立队列，避免同一显示端的分句请求并发调用底层 TTS；
 * 不同显示端仍可并行生成语音。取消操作只使对应 playbackId 的回包失效，
 * 因此无法中断的底层 TTS 即使稍后完成，也不会把旧音频发送回显示端。
 *
 * @param {object} dependencies 外部依赖
 * @param {Function} dependencies.generateTTS 文本转音频文件路径的方法
 * @param {Function} dependencies.sendToDisplay 向指定显示端发送协议消息的方法
 * @param {Function} dependencies.logError 记录服务端错误的方法
 * @returns {{handleSentenceRequest: Function, cancel: Function}} 单句请求与取消接口
 */
function createTextMediaTtsService({ generateTTS, sendToDisplay, logError }) {
    const displayQueues = new Map();
    const activePlaybacks = new Map();

    /**
     * 向显示端返回当前请求对应的错误，保持显示端能够依据页码和句子序号跳过失败句。
     *
     * @param {string} displayId 显示端标识
     * @param {object} data 原始分句请求
     * @param {string} message 面向显示端的错误说明
     */
    function sendError(displayId, data, message) {
        sendToDisplay(displayId, {
            type: 'textSentenceTtsError',
            playbackId: data?.playbackId,
            pageIndex: data?.pageIndex,
            sentenceIndex: data?.sentenceIndex,
            message
        });
    }

    /**
     * 校验显示端发来的单句 TTS 协议字段，防止无效数据进入底层合成服务。
     *
     * @param {object} data 单句请求数据
     * @returns {string|null} 错误说明；合法时为 null
     */
    function validateRequest(data) {
        if (!data || typeof data.playbackId !== 'string' || !data.playbackId) {
            return 'playbackId 不能为空';
        }
        if (!Number.isFinite(data.pageIndex)) return 'pageIndex 必须为数字';
        if (!Number.isFinite(data.sentenceIndex)) return 'sentenceIndex 必须为数字';
        if (typeof data.text !== 'string' || !data.text.trim()) return 'text 不能为空';
        return null;
    }

    /**
     * 将任务追加至指定显示端的尾部。前一个任务已处理异常，因此后续句子不会被阻塞。
     *
     * @param {string} displayId 显示端标识
     * @param {Function} task 本次需要串行执行的异步任务
     * @returns {Promise<void>} 本次任务完成后的 Promise
     */
    function enqueue(displayId, task) {
        const previous = displayQueues.get(displayId);
        // 首个请求立即进入合成，保证取消消息可以使已启动的底层请求失效；
        // 已有任务时才追加到队尾，维持同一显示端的顺序。
        const current = previous ? previous.catch(() => {}).then(task) : task();
        displayQueues.set(displayId, current);

        return current.finally(() => {
            if (displayQueues.get(displayId) === current) {
                displayQueues.delete(displayId);
            }
        });
    }

    /**
     * 判断请求是否仍属于当前有效的播放令牌。相同 playbackId 在取消后重新开始时，
     * 会创建新令牌，从而不会让取消前的异步回包混入新一轮播放。
     *
     * @param {string} displayId 显示端标识
     * @param {string} playbackId 播放标识
     * @param {symbol} token 本次请求捕获的播放令牌
     * @returns {boolean} 是否仍可向显示端回包
     */
    function isPlaybackActive(displayId, playbackId, token) {
        const activePlayback = activePlaybacks.get(displayId);
        return activePlayback?.playbackId === playbackId && activePlayback.token === token;
    }

    /**
     * 生成并下发一个句子的音频。请求异常转换为协议错误，避免冒泡中断显示端 WebSocket 消息循环。
     *
     * @param {string} displayId 显示端标识
     * @param {object} data 单句 TTS 请求
     * @returns {Promise<void>} 请求处理完成
     */
    async function handleSentenceRequest(displayId, data) {
        const validationMessage = validateRequest(data);
        if (validationMessage) {
            sendError(displayId, data, validationMessage);
            return;
        }

        const activePlayback = activePlaybacks.get(displayId);
        // 同一 playbackId 的连续分句共用令牌；取消后再次开始即使复用 ID 也会获得新令牌。
        if (activePlayback?.playbackId !== data.playbackId) {
            activePlaybacks.set(displayId, {
                playbackId: data.playbackId,
                token: Symbol(data.playbackId)
            });
        }
        const requestToken = activePlaybacks.get(displayId).token;

        await enqueue(displayId, async () => {
            try {
                const audioPath = await generateTTS(data.text);
                if (!isPlaybackActive(displayId, data.playbackId, requestToken)) return;

                sendToDisplay(displayId, {
                    type: 'tts',
                    action: 'playAudio',
                    textPlayback: true,
                    playbackId: data.playbackId,
                    pageIndex: data.pageIndex,
                    sentenceIndex: data.sentenceIndex,
                    audioUrl: `/uploads/tts/${path.basename(audioPath)}`,
                    text: data.text
                });
            } catch (error) {
                // 已取消的旧请求不再发送失败提示，避免显示端误跳过新播放的句子。
                if (!isPlaybackActive(displayId, data.playbackId, requestToken)) return;

                const message = error?.message || 'TTS 生成失败';
                logError('TextMediaTTS', `显示端 ${displayId} 分句合成失败: ${message}`);
                sendError(displayId, data, message);
            }
        });
    }

    /**
     * 使指定显示端的当前播放上下文失效。仅取消匹配 playbackId，避免旧控制消息影响新播放。
     *
     * @param {string} displayId 显示端标识
     * @param {string} playbackId 需要取消的播放标识
     */
    function cancel(displayId, playbackId) {
        if (activePlaybacks.get(displayId)?.playbackId === playbackId) {
            activePlaybacks.delete(displayId);
        }
    }

    return { handleSentenceRequest, cancel };
}

module.exports = { createTextMediaTtsService };
