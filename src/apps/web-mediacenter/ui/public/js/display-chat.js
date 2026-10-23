/*
 * 显示端聊天模块。
 *
 * 这是 display.html 内的独立功能模块，不是独立 HTML/iframe。消息仍然走父页面
 * 注入的现有 WebSocket 发送函数，历史和会话以服务端返回的快照为准。
 */
(function exposeDisplayChat(root) {
    const state = {
        initialized: false,
        visible: false,
        displayId: null,
        assistantName: '',
        assistantNames: [],
        roles: [],
        targets: [],
        session: {
            mode: 'group',
            privateTarget: null,
            privateSessionId: 'default',
            roleTarget: null
        },
        history: [],
        privateSessions: [],
        streaming: new Map(),
        manualPlayback: null,
        ignoredRequestIds: new Set(),
        requestSequence: 0,
        historyRequestSequence: 0,
        historyRequestId: null,
        contextRequestId: null,
        contextScopeKey: null,
        temporaryConversationId: null,
        pendingHistoryClear: null,
        sessionSnapshotReceived: false,
        hiddenSelection: null,
        send: null,
        bus: null,
        root: null,
        refs: {}
    };

    function escapeText(value) {
        const element = document.createElement('div');
        element.textContent = String(value ?? '');
        return element.innerHTML;
    }

    function renderMarkdown(value) {
        if (root.ChatMarkdown && typeof root.ChatMarkdown.render === 'function') {
            return root.ChatMarkdown.render(String(value || ''));
        }
        return escapeText(value).replace(/\n/gu, '<br>');
    }

    function normalizeSession(session = {}) {
        const mode = ['group', 'private', 'role', 'temporary'].includes(session.mode)
            ? session.mode
            : 'group';
        return {
            mode,
            privateTarget: typeof session.privateTarget === 'string' ? session.privateTarget : null,
            privateSessionId: typeof session.privateSessionId === 'string'
                ? session.privateSessionId
                : 'default',
            // 旧服务端缺字段时兼容当前选择；明确传null时必须接受权威清空。
            roleTarget: session.roleTarget === undefined && mode === 'role'
                ? state.session.roleTarget
                : (typeof session.roleTarget === 'string' ? session.roleTarget.trim() || null : null),
            playOnControl: session.playOnControl === true
        };
    }

    function cloneSelection() {
        return {
            mode: state.session.mode,
            privateTarget: state.session.privateTarget,
            privateSessionId: state.session.privateSessionId || 'default',
            roleTarget: state.session.roleTarget,
            playOnControl: state.session.playOnControl === true
        };
    }

    function getVoiceConversationContext() {
        if (state.session.mode === 'private' && state.session.privateTarget) {
            return { mode: 'private', target: state.session.privateTarget };
        }
        if (state.session.mode === 'role' && state.session.roleTarget) {
            return { mode: 'private', target: state.session.roleTarget };
        }
        return { mode: 'group', target: null };
    }

    function getVoiceStatusName() {
        if (state.session.mode === 'private' && state.session.privateTarget) return state.session.privateTarget;
        if (state.session.mode === 'role' && state.session.roleTarget) return state.session.roleTarget;
        return '群聊';
    }

    function notifyVoiceConversationContext() {
        if (state.bus) state.bus.publish('chat.selection', getVoiceConversationContext());
    }

    function requestSessionHistory() {
        requestContextUsage();
        const isPrivate = state.session.mode === 'private';
        const isRole = state.session.mode === 'role';
        // 同范围也可能有多次展开或恢复查询，只允许最新一次快照更新界面。
        const requestId = `display-history-${Date.now()}-${++state.historyRequestSequence}`;
        state.historyRequestId = requestId;
        if (isRole) {
            state.send({
                type: 'roleHistory',
                role: state.session.roleTarget,
                source: 'displayChat',
                requestId
            });
            return;
        }
        state.send({
            type: 'chatHistory',
            source: 'displayChat',
            requestId,
            mode: state.session.mode,
            target: isPrivate
                ? state.session.privateTarget
                : (isRole ? state.session.roleTarget : null),
            sessionId: isPrivate ? state.session.privateSessionId : 'default'
        });
    }

    function isCurrentHistoryResponse(message) {
        if (typeof message.requestId === 'string') return message.requestId === state.historyRequestId;
        // 旧服务端不回传标识时继续兼容；明确属于其他会话的历史不能清空当前内容。
        const history = Array.isArray(message.history) ? message.history : [];
        return history.length === 0 || history.some(isHistoryItemInCurrentSession);
    }

    function clearCurrentHistory() {
        const requestId = `display-clear-${Date.now()}-${++state.historyRequestSequence}`;
        const previousHistoryRequestId = state.historyRequestId;
        state.pendingHistoryClear = { requestId, scope: getHistoryScopeKey() };
        // 清空前的历史查询即使稍后返回，也不能再恢复已删除的消息。
        state.historyRequestId = requestId;
        try {
            const sent = state.send({ type: 'clearChatHistory', source: 'displayChat', requestId,
                mode: state.session.mode,
                target: state.session.mode === 'role' ? state.session.roleTarget : state.session.privateTarget,
                sessionId: state.session.mode === 'private' ? state.session.privateSessionId : null,
                displayId: state.displayId });
            if (sent === false) throw new Error('连接已断开，聊天记录未清空');
            setStatus('正在清空…');
        } catch (error) {
            state.pendingHistoryClear = null;
            state.historyRequestId = previousHistoryRequestId;
            setStatus(error.message || '清空聊天记录失败', true);
        }
    }

    function applyHistoryClearResult(message, failed = false) {
        const pending = state.pendingHistoryClear;
        if (!pending || message.requestId !== pending.requestId) return false;
        state.pendingHistoryClear = null;
        // 用户可能已经切到另一个私聊；迟到的清空结果只属于原来的范围。
        if (pending.scope !== getHistoryScopeKey()) return true;
        state.historyRequestId = null;
        if (failed) {
            setStatus(message.message || '清空聊天记录失败', true);
            return true;
        }
        abandonStreamingMessages();
        state.history = filterHistoryForCurrentSession(message.history);
        state.attachments?.reset();
        renderHistory();
        setStatus('已清空当前聊天记录');
        return true;
    }

    function getHistoryScopeKey(session = state.session) {
        const mode = session.mode || 'group';
        const target = mode === 'private'
            ? (session.privateTarget || '')
            : (mode === 'role' ? (session.roleTarget || '') : '');
        const sessionId = mode === 'private'
            ? (session.privateSessionId || 'default')
            : 'default';
        return `${mode}|${target}|${sessionId}`;
    }

    function isHistoryItemInCurrentSession(item) {
        if (!item || typeof item !== 'object') return false;
        const mode = state.session.mode || 'group';
        const itemMode = item.mode || 'group';
        if (mode === 'group') return itemMode === 'group';
        if (mode === 'private') {
            return itemMode === 'private'
                && item.target === state.session.privateTarget
                && (item.sessionId || 'default') === (state.session.privateSessionId || 'default');
        }
        if (mode === 'role') {
            return itemMode === 'role' && item.target === state.session.roleTarget;
        }
        return itemMode === mode;
    }

    function filterHistoryForCurrentSession(history) {
        return (Array.isArray(history) ? history : []).filter(isHistoryItemInCurrentSession);
    }

    function abandonStreamingMessages() {
        // 已完成消息也可能再收到迟到的协议提示；连同其请求编号一起作废。
        for (const item of state.refs.messages?.children || []) {
            if (item.dataset.requestId) state.ignoredRequestIds.add(item.dataset.requestId);
        }
        for (const requestId of state.streaming.keys()) {
            state.ignoredRequestIds.add(requestId);
            state.bus?.publish('chat.activity', { requestId, active: false });
        }
        state.streaming.clear();
        // 请求编号只用于拦截迟到消息，保留有界窗口避免长期会话无限增长。
        while (state.ignoredRequestIds.size > 256) {
            state.ignoredRequestIds.delete(state.ignoredRequestIds.values().next().value);
        }
    }

    function updateAssistantConfig(config = {}) {
        const configuredNames = Array.isArray(config.assistants)
            ? config.assistants.map((assistant) => (
                typeof assistant === 'string' ? assistant : assistant?.name
            ))
            : [];
        const candidates = [
            config.defaultName,
            ...configuredNames,
            config.assistantName,
            config.name
        ];
        const names = [];
        for (const candidate of candidates) {
            const name = String(candidate || '').trim();
            if (name && !names.includes(name)) names.push(name);
        }
        // 配置未到达或为空时只展示群聊，不插入并不存在的“助手”聊天对象。
        state.assistantNames = names;
        state.assistantName = names[0] || '';
    }

    function restoreHiddenSelection() {
        if (!state.hiddenSelection) return;
        state.session = {
            ...state.session,
            ...state.hiddenSelection
        };
        state.hiddenSelection = null;
        state.send({
            type: 'setChatSession',
            session: cloneSelection(),
            source: 'displayChat',
            displayId: state.displayId
        });
        renderHeader();
        notifyVoiceConversationContext();
    }

    function getSelectedTargetValue() {
        if (state.session.mode === 'private' && state.session.privateTarget) {
            return `private:${state.session.privateTarget}`;
        }
        if (state.session.mode === 'role' && state.session.roleTarget) {
            return `role:${state.session.roleTarget}`;
        }
        return 'group';
    }

    function getChatTtsConversationId() {
        const session = state.session || {};
        const values = [
            session.mode || 'group',
            session.mode === 'private' ? session.privateTarget : '',
            session.privateSessionId || 'default',
            session.mode === 'role' ? session.roleTarget : ''
        ];
        return values.map((value) => String(value || '').replaceAll('|', '%7C')).join('|');
    }

    function stopConversationTts({ phase = null, notify = false } = {}) {
        clearManualPlayback();
        const conversationId = getChatTtsConversationId();
        if (root.DisplayTtsController?.stopChatTts) {
            root.DisplayTtsController.stopChatTts(conversationId, phase);
        }
        state.send({
            type: 'tts',
            action: 'stop',
            chatOnly: true,
            chatTtsConversationId: conversationId,
            ...(phase ? { chatTtsPhase: phase } : {}),
            displayId: state.displayId
        });
        if (notify && root.showToast) root.showToast('已停止当前聊天播报', 'success');
    }

    function buildTargets() {
        const targets = [{ value: 'group', title: '群聊', kind: 'group' }];
        for (const assistantName of state.assistantNames) {
            targets.push({
                value: `private:${assistantName}`,
                title: assistantName,
                kind: 'assistant'
            });
        }
        for (const role of state.roles) {
            const name = typeof role === 'string' ? role : role?.name;
            if (!name) continue;
            targets.push({ value: `role:${name}`, title: name, kind: 'assistant' });
        }
        const seen = new Set();
        state.targets = targets.filter((target) => {
            if (seen.has(target.title)) return false;
            seen.add(target.title);
            return true;
        });
    }

    function parseTarget(value) {
        const [kind, ...parts] = String(value || 'group').split(':');
        const name = parts.join(':');
        if (kind === 'role' && name) {
            return { mode: 'role', roleTarget: name, privateTarget: null };
        }
        if (kind === 'private' && name) {
            return { mode: 'private', roleTarget: null, privateTarget: name };
        }
        return { mode: 'group', roleTarget: null, privateTarget: null };
    }

    function closeDropdowns() {
        for (const refs of [
            { toggle: state.refs.targetToggle, menu: state.refs.targetMenu },
            { toggle: state.refs.sessionToggle, menu: state.refs.sessionMenu }
        ]) {
            if (!refs.menu || !refs.toggle) continue;
            refs.menu.hidden = true;
            refs.toggle.setAttribute('aria-expanded', 'false');
        }
    }

    function toggleDropdown(toggle, menu) {
        if (!toggle || !menu || toggle.disabled) return;
        const shouldOpen = menu.hidden;
        closeDropdowns();
        menu.hidden = !shouldOpen;
        toggle.setAttribute('aria-expanded', String(shouldOpen));
    }

    function renderDropdown(refs, items, selectedValue, onSelect) {
        if (!refs.toggle || !refs.menu) return;
        const selected = items.find((item) => item.value === selectedValue) || items[0] || null;
        refs.toggle.textContent = selected ? selected.label : '暂无选项';
        refs.toggle.dataset.value = selected?.value || '';
        refs.toggle.disabled = items.length === 0;
        refs.menu.replaceChildren();
        for (const item of items) {
            const option = document.createElement('button');
            const isSelected = item.value === selected?.value;
            option.type = 'button';
            option.className = `display-chat-dropdown-option${isSelected ? ' is-selected' : ''}`;
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', String(isSelected));
            option.dataset.selected = String(isSelected);
            if (item.kind) option.dataset.targetKind = item.kind;
            option.textContent = item.label;
            option.addEventListener('click', () => {
                closeDropdowns();
                onSelect(item.value);
            });
            refs.menu.append(option);
        }
    }

    function renderTargetOptions() {
        if (!state.refs.targetToggle) return;
        const selected = getSelectedTargetValue();
        const selectedValue = state.targets.some((target) => target.value === selected) ? selected : 'group';
        renderDropdown(
            { toggle: state.refs.targetToggle, menu: state.refs.targetMenu },
            state.targets.map((target) => ({
                value: target.value,
                label: target.title,
                kind: target.kind
            })),
            selectedValue,
            selectTarget
        );
    }

    function renderSessionOptions() {
        if (!state.refs.sessionToggle) return;
        const sessions = state.session.mode === 'private' && state.privateSessions.length > 0
            ? state.privateSessions
            : [{ id: state.session.privateSessionId || 'default', name: '当前会话' }];
        renderDropdown(
            { toggle: state.refs.sessionToggle, menu: state.refs.sessionMenu },
            sessions.map((session) => {
                const id = session.id || 'default';
                return { value: id, label: session.name || id };
            }),
            state.session.privateSessionId || 'default',
            selectSession
        );
    }

    function renderHeader() {
        renderTargetOptions();
        renderSessionOptions();
        if (state.refs.title) {
            const selected = state.targets.find((target) => target.value === getSelectedTargetValue());
            state.refs.title.textContent = selected ? selected.title : '聊天';
        }
        // 状态标签独立于聊天可见性，关闭面板时也需跟随权威选择和助手配置刷新。
        state.bus?.publish('chat.status-name', { name: getVoiceStatusName() });
    }

    function renderThinkAndAnswer(content, reasoning = '') {
        const source = String(content || '');
        const thinkMatch = source.match(/<think>([\s\S]*?)<\/think>/iu);
        const thinkContent = String(reasoning || '').trim() || (thinkMatch ? thinkMatch[1] : '');
        const answer = thinkMatch ? source.replace(thinkMatch[0], '').trim() : source;
        const thinkHtml = thinkContent
            ? `<details class="display-chat-think" open><summary>思考</summary><div>${renderMarkdown(thinkContent)}</div></details>`
            : '';
        return `${thinkHtml}<div class="display-chat-answer">${renderMarkdown(answer)}</div>`;
    }

    function clearManualPlayback() {
        const playback = state.manualPlayback;
        if (!playback) return;
        playback.button.textContent = '🔊';
        playback.button.title = '播放语音';
        playback.button.disabled = false;
        state.manualPlayback = null;
    }

    function getReplyPlaybackContext(message = {}, history = [], index = -1) {
        if (message.chatReplyContext) return message.chatReplyContext;
        const mode = message.mode || state.session.mode;
        const template = message.templateId && message.templateId !== 'default' ? message.templateId
            : mode === 'role' ? message.target || state.session.roleTarget
                : mode === 'private' ? message.target || state.session.privateTarget : null;
        let userText = message.user;
        if (!userText && message.replyToMessageId) {
            const original = history.find(item => item.id === message.replyToMessageId || item.messageId === message.replyToMessageId);
            userText = original?.content || original?.user;
        } else if (!userText) {
            for (let previous = index - 1; previous >= 0; previous--) {
                const original = history[previous];
                if (['user', 'control'].includes(original.role) || original.user) { userText = original.content || original.user; break; }
            }
        }
        return { businessType: mode === 'role' || message.assistantType === 'agent' ? 'agent_reply' : 'ai_reply',
            templateName: template || null,
            ...(userText ? { userText: Array.from(String(userText)).slice(0, 2000).join('') } : {}) };
    }

    function addPlaybackButton(item, message, fallbackContext) {
        const raw = String(message.speech || message.content || message.assistant || '');
        const text = raw.replace(/<think>[\s\S]*?<\/think>/giu, '').trim();
        if (!text || !item || item.querySelector('.display-chat-play-btn')) return;
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'display-chat-play-btn';
        button.textContent = '🔊'; button.title = '播放语音'; button.setAttribute('aria-label', '播放这条回复的语音');
        button.addEventListener('click', () => {
            if (state.manualPlayback?.button === button) { stopConversationTts(); return; }
            if (state.manualPlayback) stopConversationTts();
            const requestId = `display-replay-${Date.now()}-${++state.requestSequence}`;
            state.manualPlayback = { button, requestId, completed: 0, total: null };
            button.textContent = '⏹'; button.title = '停止语音';
            const sent = state.send({ type: 'tts', action: 'play', requestId, text, displayId: state.displayId,
                chatTtsConversationId: getChatTtsConversationId(),
                chatReplyContext: message.chatReplyContext || fallbackContext || getReplyPlaybackContext(message) });
            if (sent === false) { clearManualPlayback(); setStatus('连接已断开，无法播放', true); }
        });
        item.querySelector('.display-chat-message-author')?.append(button);
    }

    function mediaGeneration(message) {
        return [message.videoGeneration,message.imageGeneration].find(value=>value?.status==='pending')||message.videoGeneration||message.imageGeneration;
    }
    function appendVideos(parent, videos) {
        for(const asset of videos||[]) {
            if(!/^\/uploads\/chat-videos\/[a-f0-9-]+\.(mp4|webm|mov)$/.test(asset.url||''))continue;
            const video=document.createElement('video');video.controls=true;video.preload='metadata';video.setAttribute('playsinline','');video.src=asset.url;
            if(/^\/uploads\/chat-images\/[a-f0-9-]+\.(png|jpg|webp|gif)$/.test(asset.posterUrl||''))video.poster=asset.posterUrl;
            video.style.cssText='max-width:100%;max-height:420px;border-radius:8px';parent.appendChild(video);
        }
    }
    function appendMessage(role, content, options = {}) {
        if (!state.refs.messages) return null;
        const item = document.createElement('article');
        item.className = `display-chat-message ${role === 'user' ? 'is-user' : 'is-assistant'}`;
        if (options.requestId) item.dataset.requestId = options.requestId;
        if (role === 'user') item.dataset.content = String(content || '');
        const author = document.createElement('div');
        author.className = 'display-chat-message-author';
        author.textContent = role === 'user' ? '我' : (options.author || '助手');
        const body = document.createElement('div');
        body.className = 'display-chat-message-body' + (mediaGeneration(options) ? ' chat-image-job' : '');
        body.dataset.imageStatus = mediaGeneration(options)?.status || '';
        body.innerHTML = role === 'assistant'
            ? renderThinkAndAnswer(content, options.reasoning)
            : renderMarkdown(content);
        item.appendChild(author);
        for (const entry of Array.isArray(options.gameTrace) ? options.gameTrace : []) {
            item.appendChild(createGameProtocolTip(entry));
        }
        appendVideos(body,options.videos);
        for (const file of options.attachments || []) {
            if (file.kind !== 'text' || !/^\/uploads\/chat-files\/[a-f0-9-]+\.(txt|md|log|csv|json)$/.test(file.url || '')) continue;
            const link = document.createElement('a'); link.className = 'chat-file-link'; link.href = file.url; link.download = file.name;
            link.textContent = `📄 ${file.name}`; body.append(link);
        }
        for (const image of options.images || []) {
            if (!/^\/uploads\/chat-images\/[a-f0-9-]+\.(png|jpg|webp|gif)$/.test(image.url || '')) continue;
            const img = document.createElement('img');
            img.src = image.url; img.alt = '聊天图片'; img.loading = 'lazy';
            img.style.cssText = 'max-width:100%;max-height:420px;object-fit:contain;border-radius:8px';
            body.appendChild(img);
        }
        if (mediaGeneration(options)?.status === 'pending') {
            const cancel = document.createElement('button');
            cancel.type = 'button'; cancel.textContent = '取消生成';
            cancel.addEventListener('click', () => state.send?.({ type: 'cancelChatImage', messageId: options.id }));
            body.appendChild(cancel);
        }
        item.appendChild(body);
        if (role === 'assistant' && options.playback) addPlaybackButton(item, options.playback);
        state.refs.messages.appendChild(item);
        state.refs.messages.scrollTop = state.refs.messages.scrollHeight;
        return item;
    }

    function createGameProtocolTip(entry) {
        const tip = document.createElement('div');
        tip.className = 'display-chat-game-protocol-tip';
        tip.dataset.gameSequence = String(entry.sequence || '');
        const full = String(entry.text || '');
        tip.title = full;
        tip.textContent = entry.summary || (full.startsWith('Game:五子棋,GM,快照,')
            || full.startsWith('<Game:五子棋,GM,快照,')
            ? `${full.slice(0, full.lastIndexOf(',') + 1)}棋盘已同步${full.startsWith('<') ? '>' : ''}` : full);
        return tip;
    }

    function replaceStreamingMessage(requestId, content, options = {}) {
        const item = state.streaming.get(requestId);
        if (!item) return appendMessage('assistant', content, options);
        const body = item.querySelector('.display-chat-message-body');
        if (body) body.innerHTML = renderThinkAndAnswer(content, options.reasoning);
        state.refs.messages.scrollTop = state.refs.messages.scrollHeight;
        return item;
    }

    function renderHistory() {
        if (!state.refs.messages) return;
        requestContextUsage();
        // 历史可能在回复生成中返回。保留原节点以维持 streaming Map 的引用和后续分片更新。
        const liveMessages = [...state.refs.messages.children].filter((item) =>
            state.streaming.has(item.dataset.requestId));
        state.refs.messages.replaceChildren();
        const history = filterHistoryForCurrentSession(state.history);
        for (const [index, item] of history.entries()) {
            if (!item || typeof item !== 'object') continue;
            if (mediaGeneration(item)?.source === 'main' && state.streaming.has(mediaGeneration(item).requestId)) continue;
            if (item.user !== undefined || item.assistant !== undefined) {
                if (item.user) appendMessage('user', item.user);
                if (item.assistant) {
                    appendMessage('assistant', item.assistant, { reasoning: item.reasoning,
                        playback: { ...item, chatReplyContext: getReplyPlaybackContext(item, history, index) } });
                }
                continue;
            }
            if (item.role === 'user' || item.role === 'control') {
                appendMessage('user', item.content || item.text || '', { images: item.images, videos: item.videos, attachments: item.attachments });
            } else if (item.role === 'assistant') {
                appendMessage('assistant', item.content || item.text || '', { reasoning: item.reasoning,
                    gameTrace: item.gameTrace, images: item.images, videos:item.videos, videoGeneration:item.videoGeneration, imageGeneration: mediaGeneration(item), id: item.id,
                    playback: { ...item, content: item.content || item.text, chatReplyContext: getReplyPlaybackContext(item, history, index) } });
            }
        }
        for (const item of liveMessages) {
            const last = state.refs.messages.lastElementChild;
            // 服务端通常已保存当前用户输入；与历史末条相同则只展示一份。
            if (item.classList.contains('is-user') && last?.classList.contains('is-user')
                && last.dataset.content === item.dataset.content) continue;
            state.refs.messages.appendChild(item);
        }
        state.refs.messages.scrollTop = state.refs.messages.scrollHeight;
    }

    function setStatus(message, isError = false) {
        if (!state.refs.status) return;
        state.refs.status.textContent = message || '';
        state.refs.status.classList.toggle('is-error', isError);
    }

    function contextScope() {
        const mode = state.session.mode;
        return { mode, target: mode === 'private' ? state.session.privateTarget
            : mode === 'role' ? state.session.roleTarget : null,
            sessionId: mode === 'private' ? state.session.privateSessionId || 'default'
                : mode === 'temporary' ? state.temporaryConversationId || 'default' : 'default' };
    }

    function renderContextUsage(usage = null) {
        const node = state.root?.querySelector('[data-role="context-usage"]');
        if (!node) return;
        const valid = usage && ['percent', 'inputTokens', 'budgetTokens', 'historyCount', 'historyLimit']
            .every(key => Number.isFinite(usage[key]) && usage[key] >= 0);
        node.textContent = valid ? `上下文 ≈${usage.percent}% · 对话 ${usage.historyCount}/${usage.historyLimit}` : '上下文 — · 对话 —';
        node.title = valid ? `本地文本估算 ${usage.inputTokens}/${usage.budgetTokens} token；聊天管理实际携带历史 ${usage.historyCount}/${usage.historyLimit} 条`
            + (usage.imageCount ? '；图片token未计入估算' : '') : '当前会话暂无可用统计';
    }

    function requestContextUsage() {
        if (!state.send || !state.sessionSnapshotReceived) return;
        const scope = contextScope();
        const key = JSON.stringify(scope);
        if (state.contextScopeKey !== key) renderContextUsage();
        state.contextScopeKey = key;
        state.contextRequestId = `display-context-${Date.now()}-${++state.requestSequence}`;
        if (state.send({ type: 'getChatContextUsage', requestId: state.contextRequestId,
            ...scope, displayId: state.displayId }) === false) {
            state.contextRequestId = null;
            renderContextUsage();
        }
    }

    function sendMessage(voiceText = null) {
        const input = state.refs.input;
        if (!input) return false;
        const content = typeof voiceText === 'string' ? voiceText.trim() : input.value.trim();
        if (state.attachments?.busy()) { setStatus('请等待附件上传完成', true); return false; }
        const attachments = state.attachments?.items() || [];
        if (!content && !attachments.length) return false;
        // 新消息先清理本地播放队列并通知服务端，使上一轮迟到的音频失效。
        stopConversationTts();
        const requestId = `display-chat-${Date.now()}-${++state.requestSequence}`;
        const target = state.session.mode === 'private' ? state.session.privateTarget : null;
        const message = {
            type: 'chatMessage',
            requestId,
            content,
            attachments: attachments.map(item => item.id),
            displayContent: content,
            displayId: state.displayId,
            mode: state.session.mode,
            assistantType: state.session.mode === 'role' ? 'agent' : 'llm',
            role: state.session.mode === 'role' ? state.session.roleTarget : undefined,
            target,
            templateTarget: null,
            sessionId: state.session.privateSessionId || 'default',
            chatTtsConversationId: getChatTtsConversationId(),
            playOnControl: state.session.playOnControl === true
        };
        if (!state.send(message)) {
            setStatus('当前未连接服务器，消息未发送', true);
            return false;
        }
        input.value = '';
        state.attachments?.sent();
        appendMessage('user', content, { requestId, attachments, images: attachments.filter(a => a.kind === 'image'), videos: attachments.filter(a => a.kind === 'video') });
        const streaming = appendMessage('assistant', '正在思考…', {
            requestId,
            author: state.session.roleTarget || state.session.privateTarget || state.assistantName
        });
        streaming.ttsOrigin = getReplyPlaybackContext({ user: content });
        state.streaming.set(requestId, streaming);
        state.bus?.publish('chat.activity', { requestId, active: true });
        setStatus('');
        return true;
    }

    function selectTarget(value) {
        const target = parseTarget(value);
        abandonStreamingMessages();
        state.hiddenSelection = null;
        state.session = {
            ...state.session,
            mode: target.mode,
            roleTarget: target.roleTarget,
            privateTarget: target.privateTarget,
            privateSessionId: 'default'
        };
        state.privateSessions = [];
        const session = {
            mode: state.session.mode,
            privateTarget: state.session.privateTarget,
            privateSessionId: state.session.privateSessionId,
            roleTarget: state.session.roleTarget,
            playOnControl: state.session.playOnControl
        };
        state.history = [];
        renderHistory();
        state.send({
            type: 'setChatSession',
            session,
            source: 'displayChat',
            displayId: state.displayId
        });
        requestSessionHistory();
        if (state.session.mode === 'private' && state.session.privateTarget) {
            state.send({ type: 'listPrivateSessions', target: state.session.privateTarget });
        }
        renderHeader();
        notifyVoiceConversationContext();
    }

    function selectSession(sessionId) {
        const nextSessionId = String(sessionId || 'default');
        abandonStreamingMessages();
        state.session.privateSessionId = nextSessionId;
        state.hiddenSelection = null;
        state.history = [];
        renderHistory();
        state.send({
            type: 'setChatSession',
            session: {
                mode: state.session.mode,
                privateTarget: state.session.privateTarget,
                privateSessionId: nextSessionId,
                roleTarget: state.session.roleTarget,
                playOnControl: state.session.playOnControl
            },
            source: 'displayChat',
            displayId: state.displayId
        });
        requestSessionHistory();
    }

    function renderShell() {
        state.root.innerHTML = `
            <div class="display-chat-shell">
                <section class="display-chat-window" aria-label="显示端聊天窗口">
                    <header class="display-chat-header">
                        <div class="display-chat-title-row">
                            <div>
                                <span class="display-chat-kicker">DISPLAY CHAT</span>
                                <h2 data-role="title">聊天</h2>
                            </div>
                            <button class="display-chat-icon-button" type="button" data-action="hide" aria-label="隐藏聊天">×</button>
                        </div>
                        <div class="display-chat-selectors">
                            <div class="display-chat-field">
                                <span>对象</span>
                                <div class="display-chat-dropdown">
                                    <button class="display-chat-dropdown-toggle" type="button"
                                            data-role="target-toggle" aria-label="选择聊天对象"
                                            aria-haspopup="listbox" aria-expanded="false"
                                            aria-controls="displayChatTargetMenu"></button>
                                    <div id="displayChatTargetMenu" class="display-chat-dropdown-menu"
                                         data-role="target-menu" role="listbox" hidden></div>
                                </div>
                            </div>
                            <div class="display-chat-field">
                                <span>会话</span>
                                <div class="display-chat-dropdown">
                                    <button class="display-chat-dropdown-toggle" type="button"
                                            data-role="session-toggle" aria-label="选择聊天会话"
                                            aria-haspopup="listbox" aria-expanded="false"
                                            aria-controls="displayChatSessionMenu"></button>
                                    <div id="displayChatSessionMenu" class="display-chat-dropdown-menu"
                                         data-role="session-menu" role="listbox" hidden></div>
                                </div>
                            </div>
                        </div>
                    </header>
                    <div class="display-chat-messages" data-role="messages" aria-live="polite"></div>
                    <div class="display-chat-status" data-role="status" aria-live="polite"></div>
                    <form class="display-chat-compose" data-role="compose">
                        <div class="display-chat-context-usage" data-role="context-usage" aria-live="polite">上下文 — · 对话 —</div>
                        <div data-role="attachments"></div>
                        <textarea data-role="input" rows="2" maxlength="51200" placeholder="输入消息…" aria-label="聊天输入"></textarea>
                        <div class="display-chat-compose-actions">
                            <button type="submit" class="display-chat-send">发送</button>
                            <button type="button" data-action="attach">📎 附件</button>
                            <button type="button" data-action="clear">清空</button>
                        </div>
                    </form>
                </section>
            </div>`;
        state.refs = {
            title: state.root.querySelector('[data-role="title"]'),
            targetToggle: state.root.querySelector('[data-role="target-toggle"]'),
            targetMenu: state.root.querySelector('[data-role="target-menu"]'),
            sessionToggle: state.root.querySelector('[data-role="session-toggle"]'),
            sessionMenu: state.root.querySelector('[data-role="session-menu"]'),
            messages: state.root.querySelector('[data-role="messages"]'),
            status: state.root.querySelector('[data-role="status"]'),
            compose: state.root.querySelector('[data-role="compose"]'),
            input: state.root.querySelector('[data-role="input"]')
        };
        state.refs.targetToggle.addEventListener('click', () => {
            toggleDropdown(state.refs.targetToggle, state.refs.targetMenu);
        });
        state.refs.sessionToggle.addEventListener('click', () => {
            toggleDropdown(state.refs.sessionToggle, state.refs.sessionMenu);
        });
        document.addEventListener('click', (event) => {
            if (!state.root.contains(event.target)) closeDropdowns();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') closeDropdowns();
        });
        state.refs.compose.addEventListener('submit', (event) => {
            event.preventDefault();
            sendMessage();
        });
        state.root.querySelector('[data-action="attach"]').addEventListener('click', async () => {
            try {
                if (!root.ChatAttachments) await import('/js/chat-attachments.js');
                state.attachments ||= root.ChatAttachments.create({ host: state.root.querySelector('[data-role="attachments"]'),
                    getScope: () => `${getHistoryScopeKey()}|${state.temporaryConversationId || ''}`, getPolicy: () => ({ ...(state.uploadPolicy || { images: true, videos: false }), disabled: state.uploadPolicy?.disabled || state.session.mode === 'role' }),
                    onError: message => setStatus(message, true) });
                state.attachments.choose();
            } catch (error) { setStatus(error.message || '附件入口加载失败', true); }
        });
        state.refs.input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
            }
        });
        state.root.querySelector('[data-action="hide"]').addEventListener('click', () => {
            if (root.DisplayStage) root.DisplayStage.setChatVisible(false);
        });
        state.root.querySelector('[data-action="clear"]').addEventListener('click', () => {
            if (!root.confirm || root.confirm('清空当前聊天记录？')) {
                clearCurrentHistory();
            }
        });
        buildTargets();
        renderHeader();
    }

    function handleServerMessage(message) {
        if (message?.type === 'chatContextUsage') {
            if (JSON.stringify(message.scope) !== JSON.stringify(contextScope())) return true;
            if (message.live) {
                if (!state.streaming.has(String(message.requestId || '')) || state.ignoredRequestIds.has(String(message.requestId))) return true;
                state.contextRequestId = null;
            } else if (!state.contextRequestId || message.requestId !== state.contextRequestId) return true;
            renderContextUsage(message.usage);
            return true;
        }
        if (message?.type === 'chatModelTierConfig') requestContextUsage();
        if (!message || typeof message !== 'object') return false;
        if (message.type === 'chatTtsPlayback') {
            const playback = state.manualPlayback;
            if (playback?.requestId !== message.requestId) return true;
            if (message.status === 'queued') {
                playback.total = message.audioCount || 0;
                if (playback.completed >= playback.total) clearManualPlayback();
            }
            if (['error', 'cancelled'].includes(message.status)) {
                clearManualPlayback();
                if (message.status === 'error') setStatus(message.message || '语音播放失败', true);
            }
            return true;
        }
        if (message.type === 'displayId') {
            state.displayId = message.id || null;
            state.send?.({ type: 'getChatModelTierConfig' });
            return true;
        }
        if (message.type === 'chatModelTierConfig') { state.uploadPolicy = message.uploadCapabilities || { images: true, videos: false }; return false; }
        if (message.type === 'roleList') {
            state.roles = Array.isArray(message.roles) ? message.roles : [];
            buildTargets();
            renderHeader();
            return true;
        }
        if (message.type === 'assistantConfig') {
            const config = message.config || {};
            updateAssistantConfig(config);
            buildTargets();
            renderHeader();
            return true;
        }
        if (message.type === 'chatSession') {
            const firstSnapshot = !state.sessionSnapshotReceived;
            state.sessionSnapshotReceived = true;
            const previousScopeKey = getHistoryScopeKey();
            state.session = normalizeSession(message.session || {});
            if (state.session.mode !== 'private') state.privateSessions = [];
            const nextScopeKey = getHistoryScopeKey();
            if (previousScopeKey !== nextScopeKey) {
                state.attachments?.reset();
                abandonStreamingMessages();
                state.history = [];
                renderHistory();
            }
            // 先获得权威会话再加载对应历史，关闭面板时也预加载恢复对象的记录。
            if (firstSnapshot || previousScopeKey !== nextScopeKey) requestSessionHistory();
            renderHeader();
            if (state.visible) notifyVoiceConversationContext();
            return true;
        }
        if (message.type === 'chatImageMessage') {
            const record = message.message;
            if (!record?.id || !filterHistoryForCurrentSession([record]).length) return true;
            if (mediaGeneration(record)?.source === 'main'
                && state.ignoredRequestIds.has(String(message.requestId || mediaGeneration(record).requestId))) return true;
            const index = state.history.findIndex(item => item.id === record.id);
            if (index >= 0) state.history[index] = record; else state.history.push(record);
            const live = mediaGeneration(record)?.source === 'main' && state.streaming.get(String(message.requestId || ''));
            if (live) {
                let panel = live.querySelector('.display-chat-native-images');
                if (!panel) {
                    panel = document.createElement('div'); panel.className = 'display-chat-message-body chat-image-job display-chat-native-images';
                    live.appendChild(panel);
                }
                panel.dataset.imageStatus = mediaGeneration(record).status;
                panel.replaceChildren();
                appendVideos(panel,record.videos);
                for (const image of record.images || []) {
                    if (!/^\/uploads\/chat-images\/[a-f0-9-]+\.(png|jpg|webp|gif)$/.test(image.url || '')) continue;
                    const img = document.createElement('img'); img.src = image.url; img.alt = '聊天图片';
                    img.style.cssText = 'max-width:100%;max-height:420px;object-fit:contain'; panel.appendChild(img);
                }
                if (mediaGeneration(record).status === 'pending') {
                    panel.appendChild(document.createTextNode(record.videoGeneration?'正在生成视频…':'正在生成图片…'));
                    const cancel = document.createElement('button'); cancel.textContent = '取消生成';
                    cancel.addEventListener('click', () => state.send?.({ type: 'cancelChatImage', messageId: record.id }));
                    panel.appendChild(cancel);
                }
                if (['failed', 'cancelled'].includes(mediaGeneration(record).status)) {
                    panel.appendChild(document.createTextNode(mediaGeneration(record).error || '媒体生成已取消'));
                }
                return true;
            }
            renderHistory();
            return true;
        }
        if (message.type === 'chatHistory') {
            if (message.cleared === true && applyHistoryClearResult(message)) return true;
            if (!isCurrentHistoryResponse(message)) return true;
            state.history = filterHistoryForCurrentSession(message.history);
            renderHistory();
            return true;
        }
        if (message.type === 'roleHistory') {
            if (state.session.mode === 'role' && message.role === state.session.roleTarget
                && isCurrentHistoryResponse(message)) {
                state.history = filterHistoryForCurrentSession(message.history);
                renderHistory();
            }
            return true;
        }
        if (message.type === 'chatHistoryError') {
            if (applyHistoryClearResult(message, true)) return true;
            if (typeof message.requestId === 'string' && !isCurrentHistoryResponse(message)) return true;
            setStatus(message.message || '读取聊天记录失败', true);
            return true;
        }
        if (message.type === 'privateSessions') {
            state.privateSessions = Array.isArray(message.sessions) ? message.sessions : [];
            renderSessionOptions();
            return true;
        }
        if (message.type === 'privateSessionCreated') {
            if (message.session) {
                state.privateSessions = [...state.privateSessions, message.session];
                renderSessionOptions();
            }
            return true;
        }
        if (message.type === 'privateSessionDeleted' || message.type === 'privateSessionSwitched') {
            return true;
        }
        if (message.type === 'chatInput') {
            if (message.displayId && state.displayId && message.displayId !== state.displayId) return true;
            const requestId = String(message.requestId || '');
            const content = String(message.content || '').trim();
            if (!requestId || !content || state.streaming.has(requestId)
                || state.ignoredRequestIds.has(requestId)) return true;
            state.bus?.publish('chat.activity', { requestId, active: true });
            appendMessage('user', content, { requestId });
            const streaming = appendMessage('assistant', '正在思考…', {
                requestId,
                author: state.session.roleTarget || state.session.privateTarget || state.assistantName
            });
            streaming.ttsOrigin = getReplyPlaybackContext({ user: content });
            state.streaming.set(requestId, streaming);
            return true;
        }
        if (message.type === 'chatGameProtocol') {
            if (message.displayId && state.displayId && message.displayId !== state.displayId) return true;
            const requestId = String(message.requestId || '');
            if (!requestId || typeof message.text !== 'string' || state.ignoredRequestIds.has(requestId)) return true;
            const item = state.streaming.get(requestId);
            const duplicate = [...state.refs.messages.querySelectorAll('.display-chat-game-protocol-tip')]
                .some(tip => tip.parentElement?.dataset.requestId === requestId
                    && tip.dataset.gameSequence === String(message.sequence));
            if (duplicate) return true;
            const tip = createGameProtocolTip(message);
            if (item) item.insertBefore(tip, item.querySelector('.display-chat-message-body'));
            else {
                const standalone = document.createElement('article');
                standalone.className = 'display-chat-game-protocol-only';
                standalone.dataset.requestId = requestId;
                standalone.appendChild(tip);
                state.refs.messages.appendChild(standalone);
            }
            state.refs.messages.scrollTop = state.refs.messages.scrollHeight;
            return true;
        }
        if (message.type === 'chatStatus') {
            const requestId = String(message.requestId || '');
            const reply = state.streaming.get(requestId);
            if (!reply || state.ignoredRequestIds.has(requestId) || typeof message.message !== 'string') return true;
            let status = reply.querySelector('.chat-request-status');
            if (!status) {
                status = document.createElement('div'); status.className = 'chat-request-status';
                status.style.cssText = 'font-size:12px;color:var(--text-secondary,#999);padding:4px 0';
                status.setAttribute('role', 'status'); reply.insertBefore(status, reply.querySelector('.display-chat-message-body'));
            }
            status.textContent = message.message;
            return true;
        }
        if (message.type === 'chatChunk') {
            const requestId = String(message.requestId || '');
            if (!requestId) return true;
            if (state.ignoredRequestIds.has(requestId)) return true;
            const previous = state.streaming.get(requestId);
            const current = previous?.dataset.content || '';
            const chunk = typeof message.chunk === 'string'
                ? message.chunk
                : (typeof message.message?.content === 'string' ? message.message.content : '');
            // 服务端携带完整快照时以快照为准；仅旧消息缺快照时才累加增量。
            const content = typeof message.message === 'string' ? message.message : current + chunk;
            if (previous) previous.dataset.content = content;
            replaceStreamingMessage(requestId, content, {
                author: state.session.roleTarget || state.session.privateTarget || state.assistantName,
                reasoning: message.reasoning || message.message?.reasoning || ''
            });
            return true;
        }
        if (message.type === 'chatResponse') {
            const requestId = String(message.requestId || '');
            state.streaming.get(requestId)?.querySelector('.chat-request-status')?.remove();
            state.bus?.publish('chat.activity', { requestId, active: false });
            if (state.ignoredRequestIds.has(requestId)) {
                return true;
            }
            if (message.temporaryConversationId) state.temporaryConversationId = message.temporaryConversationId;
            requestContextUsage();
            // 完成回复已比此前请求的历史快照更新，迟到的旧快照不能擦除这条回复。
            state.historyRequestId = null;
            if (!message.success) {
                replaceStreamingMessage(requestId, `错误：${message.error || '聊天请求失败'}`, {
                    author: '系统'
                });
                setStatus(message.error || '聊天请求失败', true);
                state.streaming.delete(requestId);
                return true;
            }
            const responseMessage = message.message || {};
            const content = typeof responseMessage === 'string'
                ? responseMessage
                : (responseMessage.content || responseMessage.assistant || message.content || '');
            const finished = replaceStreamingMessage(requestId, content, {
                author: state.session.roleTarget || state.session.privateTarget || state.assistantName,
                reasoning: responseMessage.reasoning || message.reasoning || ''
            });
            addPlaybackButton(finished, { ...(typeof responseMessage === 'object' ? responseMessage : {}),
                content, speech: responseMessage.speech || message.speech }, finished?.ttsOrigin);
            state.streaming.delete(requestId);
            if (Array.isArray(message.history)) {
                state.history = filterHistoryForCurrentSession(message.history);
            }
            return true;
        }
        return false;
    }

    function setVisible(visible, focus = false) {
        const nextVisible = visible === true;
        const visibilityChanged = nextVisible !== state.visible;
        if (!nextVisible && visibilityChanged) {
            state.hiddenSelection = cloneSelection();
        }
        state.visible = nextVisible;
        if (state.root) {
            state.root.classList.toggle('is-visible', state.visible);
            state.root.setAttribute('aria-hidden', String(!state.visible));
        }
        if (state.visible && visibilityChanged) {
            restoreHiddenSelection();
            renderHeader();
            requestSessionHistory();
            if (state.session.mode === 'private' && state.session.privateTarget) {
                state.send({ type: 'listPrivateSessions', target: state.session.privateTarget });
            }
            if (state.refs.messages) state.refs.messages.scrollTop = state.refs.messages.scrollHeight;
        }
        if (state.visible && focus && state.refs.input) state.refs.input.focus();
        if (!state.visible && document.activeElement === state.refs.input) state.refs.input.blur();
    }

    function resize() {
        if (!state.root) return;
        const inset = getComputedStyle(state.root).getPropertyValue('--display-keyboard-inset');
        state.root.style.setProperty('--display-chat-keyboard-inset', inset || '0px');
    }

    function init(options = {}) {
        if (state.initialized || !options.root) return;
        state.root = options.root;
        state.bus = options.bus;
        state.send = typeof options.send === 'function' ? options.send : () => false;
        if (state.bus) {
            state.bus.subscribe('server.message', handleServerMessage);
            state.bus.subscribe('transport.changed', ({ available }) => {
                if (available) { requestContextUsage(); return; }
                state.contextRequestId = null;
                renderContextUsage();
                state.sessionSnapshotReceived = false;
                clearManualPlayback();
                state.historyRequestId = null;
            });
            state.bus.subscribe('display.identity', ({ displayId }) => {
                state.displayId = displayId;
            });
        }
        renderShell();
        root.addEventListener('display-manual-tts-finished', event => {
            const playback = state.manualPlayback;
            if (playback?.requestId !== event.detail?.requestId) return;
            if (event.detail.status === 'cancelled') { clearManualPlayback(); return; }
            playback.completed++;
            if (playback.total !== null && playback.completed >= playback.total) clearManualPlayback();
        });
        setVisible(false);
        state.initialized = true;
    }

    root.DisplayChat = Object.freeze({
        getVoiceConversationContext,
        getVoiceStatusName,
        handleServerMessage,
        init,
        resize,
        setVisible,
        sendVoiceMessage: (text) => sendMessage(text),
        stopConversationTts
    });
}(window));
