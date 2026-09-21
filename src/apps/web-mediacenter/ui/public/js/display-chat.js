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
        assistantName: '助手',
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
        requestSequence: 0,
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
            roleTarget: typeof session.roleTarget === 'string'
                ? session.roleTarget
                : (mode === 'role' ? state.session.roleTarget : null),
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

    function notifyVoiceConversationContext() {
        if (state.bus) state.bus.publish('chat.selection', getVoiceConversationContext());
    }

    function requestSessionHistory() {
        state.send({
            type: 'chatHistory',
            source: 'displayChat',
            mode: state.session.mode,
            target: state.session.privateTarget,
            sessionId: state.session.privateSessionId
        });
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
        requestSessionHistory();
        if (state.session.mode === 'private' && state.session.privateTarget) {
            state.send({ type: 'listPrivateSessions', target: state.session.privateTarget });
        }
        renderHeader();
        renderHistory();
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
        const targets = [{ value: 'group', title: '群聊', hint: '所有角色' }];
        if (state.assistantName) {
            targets.push({
                value: `private:${state.assistantName}`,
                title: state.assistantName,
                hint: '私聊'
            });
        }
        for (const role of state.roles) {
            const name = typeof role === 'string' ? role : role?.name;
            if (!name) continue;
            targets.push({ value: `role:${name}`, title: name, hint: '角色' });
            targets.push({ value: `private:${name}`, title: name, hint: '私聊' });
        }
        const seen = new Set();
        state.targets = targets.filter((target) => {
            if (seen.has(target.value)) return false;
            seen.add(target.value);
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
            option.type = 'button';
            option.className = 'display-chat-dropdown-option';
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', String(item.value === selected?.value));
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
                label: `${target.title} · ${target.hint}`
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

    function appendMessage(role, content, options = {}) {
        if (!state.refs.messages) return null;
        const item = document.createElement('article');
        item.className = `display-chat-message ${role === 'user' ? 'is-user' : 'is-assistant'}`;
        if (options.requestId) item.dataset.requestId = options.requestId;
        const author = document.createElement('div');
        author.className = 'display-chat-message-author';
        author.textContent = role === 'user' ? '我' : (options.author || '助手');
        const body = document.createElement('div');
        body.className = 'display-chat-message-body';
        body.innerHTML = role === 'assistant'
            ? renderThinkAndAnswer(content, options.reasoning)
            : renderMarkdown(content);
        item.append(author, body);
        state.refs.messages.appendChild(item);
        state.refs.messages.scrollTop = state.refs.messages.scrollHeight;
        return item;
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
        state.refs.messages.replaceChildren();
        for (const item of state.history) {
            if (!item || typeof item !== 'object') continue;
            if (item.user !== undefined || item.assistant !== undefined) {
                if (item.user) appendMessage('user', item.user);
                if (item.assistant) {
                    appendMessage('assistant', item.assistant, { reasoning: item.reasoning });
                }
                continue;
            }
            if (item.role === 'user' || item.role === 'control') {
                appendMessage('user', item.content || item.text || '');
            } else if (item.role === 'assistant') {
                appendMessage('assistant', item.content || item.text || '', { reasoning: item.reasoning });
            }
        }
    }

    function setStatus(message, isError = false) {
        if (!state.refs.status) return;
        state.refs.status.textContent = message || '';
        state.refs.status.classList.toggle('is-error', isError);
    }

    function sendMessage() {
        const input = state.refs.input;
        if (!input) return;
        const content = input.value.trim();
        if (!content) return;
        // 新消息先清理本地播放队列并通知服务端，使上一轮迟到的音频失效。
        stopConversationTts();
        const requestId = `display-chat-${Date.now()}-${++state.requestSequence}`;
        const target = state.session.mode === 'private' ? state.session.privateTarget : null;
        const message = {
            type: 'chatMessage',
            requestId,
            content,
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
            return;
        }
        input.value = '';
        appendMessage('user', content);
        const streaming = appendMessage('assistant', '正在思考…', {
            requestId,
            author: state.session.roleTarget || state.session.privateTarget || state.assistantName
        });
        state.streaming.set(requestId, streaming);
        setStatus('');
    }

    function selectTarget(value) {
        const target = parseTarget(value);
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
        renderHistory();
        notifyVoiceConversationContext();
    }

    function selectSession(sessionId) {
        const nextSessionId = String(sessionId || 'default');
        state.session.privateSessionId = nextSessionId;
        state.hiddenSelection = null;
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
                        <textarea data-role="input" rows="2" maxlength="51200" placeholder="输入消息…" aria-label="聊天输入"></textarea>
                        <div class="display-chat-compose-actions">
                            <button type="button" data-action="clear">清空</button>
                            <button type="submit" class="display-chat-send">发送</button>
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
                state.send({
                    type: 'clearChatHistory',
                    mode: state.session.mode,
                    target: state.session.privateTarget,
                    sessionId: state.session.privateSessionId,
                    displayId: state.displayId
                });
            }
        });
        buildTargets();
        renderHeader();
    }

    function handleServerMessage(message) {
        if (!message || typeof message !== 'object') return false;
        if (message.type === 'displayId') {
            state.displayId = message.id || null;
            return true;
        }
        if (message.type === 'roleList') {
            state.roles = Array.isArray(message.roles) ? message.roles : [];
            buildTargets();
            renderHeader();
            return true;
        }
        if (message.type === 'assistantConfig') {
            const config = message.config || {};
            state.assistantName = config.assistantName || config.name || '助手';
            buildTargets();
            renderHeader();
            return true;
        }
        if (message.type === 'chatSession') {
            const previousRole = state.session.roleTarget;
            state.session = normalizeSession(message.session || {});
            if (state.session.mode === 'role') state.session.roleTarget = previousRole;
            if (state.session.mode !== 'private') state.privateSessions = [];
            renderHeader();
            if (state.visible) notifyVoiceConversationContext();
            return true;
        }
        if (message.type === 'chatHistory') {
            state.history = Array.isArray(message.history) ? message.history : [];
            renderHistory();
            return true;
        }
        if (message.type === 'chatHistoryError') {
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
            if (!requestId || !content || state.streaming.has(requestId)) return true;
            appendMessage('user', content);
            const streaming = appendMessage('assistant', '正在思考…', {
                requestId,
                author: state.session.roleTarget || state.session.privateTarget || state.assistantName
            });
            state.streaming.set(requestId, streaming);
            return true;
        }
        if (message.type === 'chatChunk') {
            const requestId = String(message.requestId || '');
            if (!requestId) return true;
            const previous = state.streaming.get(requestId);
            const current = previous?.dataset.content || '';
            const chunk = typeof message.chunk === 'string'
                ? message.chunk
                : (typeof message.message?.content === 'string' ? message.message.content : '');
            const content = current + chunk;
            if (previous) previous.dataset.content = content;
            replaceStreamingMessage(requestId, content, {
                author: state.session.roleTarget || state.session.privateTarget || state.assistantName,
                reasoning: message.message?.reasoning || ''
            });
            return true;
        }
        if (message.type === 'chatResponse') {
            const requestId = String(message.requestId || '');
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
            replaceStreamingMessage(requestId, content, {
                author: state.session.roleTarget || state.session.privateTarget || state.assistantName,
                reasoning: responseMessage.reasoning || message.reasoning || ''
            });
            state.streaming.delete(requestId);
            if (Array.isArray(message.history)) {
                state.history = message.history;
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
            state.bus.subscribe('display.identity', ({ displayId }) => {
                state.displayId = displayId;
            });
        }
        renderShell();
        setVisible(false);
        state.initialized = true;
    }

    root.DisplayChat = Object.freeze({
        getVoiceConversationContext,
        handleServerMessage,
        init,
        resize,
        setVisible,
        stopConversationTts
    });
}(window));
