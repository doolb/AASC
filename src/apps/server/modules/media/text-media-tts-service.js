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
 * @param {Function} [dependencies.getDisplayCapabilities] 读取显示端当前能力的方法；返回空值视为离线
 * @returns {{handleSentenceRequest: Function, cancel: Function}} 单句请求与取消接口
 */
function createTextMediaTtsService({ generateTTS, sendToDisplay, logError, getDisplayCapabilities }) {
    const displayQueues = new Map();
    const activePlaybacks = new Map();
    const displayRoutes = new Map();

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
     * 规范化显示端 ID 列表。播放路由依赖控制端本次选择顺序，因此这里仅去重，
     * 不重新排序，避免语音目标选择和控制端选择顺序不一致。
     *
     * @param {unknown} displayIds 原始显示端 ID 列表
     * @returns {string[]} 去重后的显示端 ID
     */
    function normalizeDisplayIds(displayIds) {
        if (!Array.isArray(displayIds)) return [];
        const seen = new Set();
        const normalized = [];
        for (const displayId of displayIds) {
            if (typeof displayId !== 'string' || !displayId || seen.has(displayId)) continue;
            seen.add(displayId);
            normalized.push(displayId);
        }
        return normalized;
    }

    /**
     * 判断显示端是否仍在线且手动允许语音播放。旧客户端路径没有能力读取依赖时，
     * 仅允许源端兼容播放；远程路由必须拿到明确的在线能力。
     *
     * @param {string} displayId 显示端 ID
     * @param {boolean} allowUnknown 是否允许缺少能力读取结果时继续
     * @returns {boolean} 是否可作为语音播放设备
     */
    function hasVoicePlayback(displayId, allowUnknown = false) {
        if (typeof getDisplayCapabilities !== 'function') return allowUnknown;
        const capabilities = getDisplayCapabilities(displayId);
        if (!capabilities) return allowUnknown;
        return capabilities.voicePlayback === true;
    }

    /**
     * 从显式路由字段构造播放上下文。route 缺失表示旧协议，安全回落到源显示端；
     * route 存在但目标为空表示服务器已判定本次选中设备里没有语音目标。
     *
     * @param {string} originDisplayId 源文本显示端
     * @param {object} data 分句请求
     * @returns {object} 播放上下文
     */
    function normalizeRoute(originDisplayId, route) {
        const selectedDisplayIds = normalizeDisplayIds(route.selectedDisplayIds);
        const selected = selectedDisplayIds.length ? selectedDisplayIds : [originDisplayId];
        const selectedVoiceDisplayIds = normalizeDisplayIds(route.selectedVoiceDisplayIds)
            .filter((displayId) => selected.includes(displayId));
        const hasTargetField = Object.prototype.hasOwnProperty.call(route, 'voiceTargetDisplayId');
        const voiceTargetDisplayId = hasTargetField
            ? (typeof route.voiceTargetDisplayId === 'string' && route.voiceTargetDisplayId ? route.voiceTargetDisplayId : null)
            : originDisplayId;

        return {
            selectedDisplayIds: selected,
            selectedVoiceDisplayIds,
            voiceTargetDisplayId
        };
    }

    /**
     * 从服务器可信路由或旧协议默认值构造播放上下文。可信路由由 server-app
     * 在下发媒体/播放列表时注册；显示端请求里的 route 只用于兼容已有活跃上下文，
     * 不能作为首次远程路由的权威来源。
     *
     * @param {string} originDisplayId 源文本显示端
     * @param {object} data 分句请求
     * @param {object} route 服务器注册 route 或旧协议空 route
     * @param {boolean} explicitRoute 是否为服务器显式路由
     * @returns {object} 播放上下文
     */
    function buildPlaybackContext(originDisplayId, data, route, explicitRoute) {
        return {
            playbackId: data.playbackId,
            token: Symbol(data.playbackId),
            ...normalizeRoute(originDisplayId, route),
            explicitRoute,
            pendingRemoteSentences: new Map()
        };
    }

    function makeRemoteSentenceKey(targetDisplayId, data) {
        if (typeof targetDisplayId !== 'string' || !targetDisplayId) return null;
        if (typeof data?.playbackId !== 'string' || !data.playbackId) return null;
        if (!Number.isFinite(data.pageIndex) || !Number.isFinite(data.sentenceIndex)) return null;
        return [targetDisplayId, data.playbackId, data.pageIndex, data.sentenceIndex].join('\u0000');
    }

    function registerPendingRemoteSentence(context, targetDisplayId, data) {
        const key = makeRemoteSentenceKey(targetDisplayId, data);
        if (!key) return;
        context.pendingRemoteSentences.set(key, Symbol(key));
    }

    function consumePendingRemoteSentence(context, targetDisplayId, data) {
        const key = makeRemoteSentenceKey(targetDisplayId, data);
        return key ? context.pendingRemoteSentences.delete(key) : false;
    }

    /**
     * 注册服务器计算出的文本语音路由。该路由是新播放首个 textSentenceTts
     * 的权威上下文；新媒体或新播放列表覆盖旧 route，并使旧 activePlayback 失效。
     *
     * @param {string} originDisplayId 源文本显示端
     * @param {object} trustedRoute server-app 根据本次选中显示端计算出的 route
     */
    function setDisplayRoute(originDisplayId, trustedRoute) {
        if (!originDisplayId || !trustedRoute || typeof trustedRoute !== 'object') return;
        displayRoutes.set(originDisplayId, normalizeRoute(originDisplayId, trustedRoute));
        activePlaybacks.delete(originDisplayId);
    }

    /**
     * 清理源显示端的服务器注册 route 和当前播放上下文。用于切到非文本媒体或停止播放。
     *
     * @param {string} originDisplayId 源文本显示端
     */
    function clearDisplayRoute(originDisplayId) {
        displayRoutes.delete(originDisplayId);
        activePlaybacks.delete(originDisplayId);
    }

    /**
     * 写入服务器已知的播放上下文。测试和 server-app 均可复用该入口；
     * 同一 playbackId 下只刷新路由字段，保留既有 token，避免误复活已取消请求。
     *
     * @param {string} originDisplayId 源文本显示端
     * @param {object} context 路由上下文
     */
    function setPlaybackContext(originDisplayId, context) {
        if (!originDisplayId || !context?.playbackId) return;
        const previous = activePlaybacks.get(originDisplayId);
        const samePlayback = previous?.playbackId === context.playbackId;
        activePlaybacks.set(originDisplayId, {
            playbackId: context.playbackId,
            token: samePlayback ? previous.token : Symbol(context.playbackId),
            ...normalizeRoute(originDisplayId, context),
            explicitRoute: context.explicitRoute !== false,
            pendingRemoteSentences: samePlayback ? previous.pendingRemoteSentences : new Map()
        });
    }

    /**
     * 取得本次请求要使用的播放上下文。旧 playbackId 或首次请求会创建新上下文；
     * 已存在上下文时以服务器保存值为准，防止客户端临时把 route 改到未选设备。
     *
     * @param {string} originDisplayId 源文本显示端
     * @param {object} data 分句请求
     * @returns {object} 播放上下文
     */
    function getOrCreatePlaybackContext(originDisplayId, data) {
        const activePlayback = activePlaybacks.get(originDisplayId);
        if (activePlayback?.playbackId === data.playbackId) return { context: activePlayback };

        const trustedRoute = displayRoutes.get(originDisplayId);
        if (!trustedRoute && data.route && typeof data.route === 'object') {
            return { message: '未注册服务器语音路由' };
        }

        const context = trustedRoute
            ? buildPlaybackContext(originDisplayId, data, trustedRoute, true)
            : buildPlaybackContext(originDisplayId, data, {}, false);
        activePlaybacks.set(originDisplayId, context);
        return { context };
    }

    /**
     * 校验并返回本句实际语音目标。显式 route 不能扩展到未选设备；
     * 旧协议没有 route 时保持源端播放兼容。
     *
     * @param {string} originDisplayId 源文本显示端
     * @param {object} context 播放上下文
     * @returns {{targetDisplayId?: string, message?: string}} 校验结果
     */
    function resolveRequestTarget(originDisplayId, context) {
        const targetDisplayId = context.voiceTargetDisplayId;
        if (!targetDisplayId) return { message: '没有可用的语音播放显示端' };
        if (!context.selectedDisplayIds.includes(targetDisplayId)) {
            return { message: '语音播放目标不在本次选中的显示端中' };
        }
        if (targetDisplayId === originDisplayId) {
            return hasVoicePlayback(originDisplayId, !context.explicitRoute)
                ? { targetDisplayId }
                : { message: '源显示端未启用语音播放' };
        }
        if (!hasVoicePlayback(targetDisplayId, false)) {
            return { message: '语音播放目标离线或未启用语音播放' };
        }
        return { targetDisplayId };
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

        // 同一 playbackId 的连续分句共用令牌；取消后再次开始即使复用 ID 也会获得新令牌。
        const contextResult = getOrCreatePlaybackContext(displayId, data);
        if (contextResult.message) {
            sendError(displayId, data, contextResult.message);
            return;
        }
        const playbackContext = contextResult.context;
        const routeResult = resolveRequestTarget(displayId, playbackContext);
        if (routeResult.message) {
            sendError(displayId, data, routeResult.message);
            return;
        }
        const requestToken = playbackContext.token;
        const targetDisplayId = routeResult.targetDisplayId;

        await enqueue(displayId, async () => {
            try {
                const audioPath = await generateTTS(data.text);
                if (!isPlaybackActive(displayId, data.playbackId, requestToken)) return;

                const baseMessage = {
                    type: 'tts',
                    action: 'playAudio',
                    playbackId: data.playbackId,
                    pageIndex: data.pageIndex,
                    sentenceIndex: data.sentenceIndex,
                    audioUrl: `/uploads/tts/${path.basename(audioPath)}`,
                    text: data.text
                };
                if (targetDisplayId === displayId) {
                    sendToDisplay(displayId, {
                        ...baseMessage,
                        textPlayback: true
                    });
                    return;
                }
                sendToDisplay(targetDisplayId, {
                    ...baseMessage,
                    textPlaybackRemote: true,
                    originDisplayId: displayId,
                    voiceTargetDisplayId: targetDisplayId
                });
                registerPendingRemoteSentence(playbackContext, targetDisplayId, data);
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
     * 处理远程语音显示端的播放结束/失败回执。只接受当前播放上下文中的目标设备，
     * 校验通过后转发给源文本显示端，让源端按“当前句已结束”推进下一句。
     *
     * @param {string} targetDisplayId 回执来源显示端
     * @param {object} data 回执数据
     */
    function handleSentenceFinished(targetDisplayId, data) {
        const originDisplayId = data?.originDisplayId;
        const playbackId = data?.playbackId;
        if (typeof originDisplayId !== 'string' || typeof playbackId !== 'string') return;
        const context = activePlaybacks.get(originDisplayId);
        const status = data.status === 'failed' ? 'failed' : 'ended';
        const isValidContext = context?.playbackId === playbackId
            && context.voiceTargetDisplayId === targetDisplayId
            && context.selectedDisplayIds.includes(targetDisplayId)
            && hasVoicePlayback(targetDisplayId, false);
        if (!isValidContext) return;
        if (!consumePendingRemoteSentence(context, targetDisplayId, data)) return;

        sendToDisplay(originDisplayId, {
            type: 'textSentenceTtsFinished',
            originDisplayId,
            voiceTargetDisplayId: targetDisplayId,
            playbackId,
            pageIndex: data.pageIndex,
            sentenceIndex: data.sentenceIndex,
            status
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

    return {
        handleSentenceRequest,
        handleSentenceFinished,
        setDisplayRoute,
        clearDisplayRoute,
        setPlaybackContext,
        cancel
    };
}

module.exports = { createTextMediaTtsService };
