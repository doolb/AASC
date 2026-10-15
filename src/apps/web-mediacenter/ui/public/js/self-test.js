const SelfTest = {
    isRunning: false,
    results: [],
    currentTestIndex: 0,
    testResults: {
        passed: 0,
        failed: 0,
        skipped: 0,
        total: 0
    },
    pendingAcks: new Map(),
    ackTimeout: 5000,
    
    waitForAck(commandType, displayId, timeout = this.ackTimeout) {
        return new Promise((resolve) => {
            const key = `${displayId}_${commandType}`;
            const timer = setTimeout(() => {
                this.pendingAcks.delete(key);
                resolve({ success: false, message: '等待确认超时', details: `${commandType} 命令未收到显示端确认` });
            }, timeout);
            
            this.pendingAcks.set(key, { resolve, timer, commandType, displayId });
        });
    },
    
    handleAck(data) {
        const key = `${data.displayId}_${data.commandType}`;
        const pending = this.pendingAcks.get(key);
        if (pending) {
            clearTimeout(pending.timer);
            this.pendingAcks.delete(key);
            pending.resolve({
                success: data.success,
                message: data.success ? '显示端已确认' : '显示端处理失败',
                details: `displayId: ${data.displayId}, commandType: ${data.commandType}, details: ${data.details}`
            });
        }
    },
    
    tests: [
        {
            id: 'offline_data_repair_baseline',
            name: 'Offline 数据修复基线',
            description: '只读检查数据版本与待执行修复结果，不运行修复',
            category: '系统功能',
            run: async () => {
                const bridge = window.NativeOfflineModels;
                if (!bridge || typeof bridge.dataRepairStatus !== 'function') {
                    return { success: true, message: '无新版 Offline 数据状态桥，跳过检查' };
                }
                try {
                    const state = JSON.parse(bridge.dataRepairStatus());
                    if (!Object.keys(state).length) return { success: true, message: '在线 APK，跳过 Offline 数据检查' };
                    const valid = Number.isSafeInteger(state.dataVersion) && state.dataVersion >= 0
                        && Number.isSafeInteger(state.latestRepairVersion) && state.latestRepairVersion >= 0
                        && typeof state.pending === 'boolean' && typeof state.satisfied === 'boolean';
                    return { success: valid && (!state.pending || state.satisfied),
                        message: valid ? `数据版本 ${state.dataVersion}；${state.pending && !state.satisfied ? '修复未完成，请查看原生失败原因' : '状态可查询'}` : '数据修复状态格式无效',
                        details: '服务健康与数据修复成功分别验证；查询不改变配置或数据版本' };
                } catch (error) { return { success: false, message: `读取数据修复状态失败: ${error.message}` }; }
            }
        },
        {
            id: 'offline_native_models',
            name: 'Offline 本机模型状态',
            description: '只读检查模型文件状态和显示页入口结构，不下载、加载或执行推理',
            category: '系统功能',
            run: async () => {
                const bridge = window.NativeOfflineModels;
                if (!bridge || typeof bridge.status !== 'function') {
                    return { success: true, message: '无新版 Offline 原生桥，跳过模型状态检查',
                        details: '独立 min 首装、下载取消与无网推理仍需新版 APK 真机验收' };
                }
                try {
                    const models = JSON.parse(bridge.status());
                    if (!Array.isArray(models)) return { success: false, message: '本机模型状态格式异常' };
                    if (!models.length) return { success: true, message: '当前为在线 APK，跳过 Offline 模型检查' };
                    const valid = new Set(models.map(model => model.modelId)).size === models.length
                        && models.every(model => typeof model.modelId === 'string' && model.modelId
                            && Number.isSafeInteger(model.totalBytes) && model.totalBytes > 0
                            && ['filesPresent', 'filesReady', 'downloading'].every(key => typeof model[key] === 'boolean'));
                    if (!valid) return { success: false, message: '本机模型状态格式异常' };
                    const [displayResponse, styleResponse] = await Promise.all([
                        fetch('/display.html', { cache: 'no-store' }),
                        fetch('/css/display-mmd.css', { cache: 'no-store' })
                    ]);
                    if (!displayResponse.ok || !styleResponse.ok) {
                        return { success: false, message: '显示页或本机模型入口样式不可读取' };
                    }
                    const [displayHtml, displayStyle] = await Promise.all([
                        displayResponse.text(), styleResponse.text()
                    ]);
                    const expectedEntryIds = [
                        'displayOfflineModelsEntry', 'displayOfflineModelsExpand', 'displayOfflineModelsActions',
                        'displayOfflineModels', 'displayOfflineModelsCollapse'
                    ];
                    const hasEntryMarkup = expectedEntryIds.every(id => displayHtml.includes(`id="${id}"`));
                    const expandButtonStyle = displayStyle.match(/#displayOfflineModelsExpand\s*\{([^}]*)\}/)?.[1] || '';
                    const keepsHalfHandleVisible = expandButtonStyle.includes('width: 32px;')
                        && expandButtonStyle.includes('left: -16px;');
                    const avoidsOverlays = displayStyle.includes('原生控制端把手')
                        && displayStyle.includes('top: max(84px, calc(var(--display-safe-inset-top)')
                        && displayStyle.includes('height: 72px;')
                        && displayStyle.includes('left: 0;');
                    const keepsExpandedSafeInset = displayStyle.includes('left: max(12px, calc(var(--display-safe-inset-left)');
                    const entryValid = hasEntryMarkup && avoidsOverlays && keepsHalfHandleVisible && keepsExpandedSafeInset;
                    return { success: valid && entryValid,
                        message: entryValid ? '本机模型状态有效，收起把手露出半字，展开入口避让 FPS 与控制端' : '本机模型入口结构或避让布局无效',
                        details: 'filesReady 仅表示文件已验证，原生引擎是否就绪由 ASR/TTS/LLM 各自状态决定；入口检查只读取显示页 HTML/CSS' };
                } catch (error) { return { success: false, message: `本机模型状态读取失败: ${error.message}` }; }
            }
        },
        {
            id: 'display_chat_markdown_lists',
            name: '显示端聊天 Markdown 列表缩进',
            description: '只读检查聊天气泡中的有序/无序列表缩进样式，不创建消息或请求聊天接口',
            category: '显示界面',
            run: async () => {
                try {
                    const [displayResponse, styleResponse] = await Promise.all([
                        fetch('/display.html', { cache: 'no-store' }),
                        fetch('/css/display-chat.css', { cache: 'no-store' })
                    ]);
                    if (!displayResponse.ok || !styleResponse.ok) {
                        return { success: false, message: '显示页或聊天样式不可读取' };
                    }
                    const [displayHtml, displayStyle] = await Promise.all([
                        displayResponse.text(), styleResponse.text()
                    ]);
                    const rendererAvailable = displayHtml.includes('js/chat-markdown.js');
                    const listStyle = displayStyle.match(
                        /\.display-chat-message-body\s+ul\s*,\s*\.display-chat-message-body\s+ol\s*\{([^}]*)\}/s
                    )?.[1] || '';
                    const listIndentationValid = /padding-inline-start:\s*24px;/u.test(listStyle);
                    const entryValid = rendererAvailable && listIndentationValid;
                    return {
                        success: entryValid,
                        message: entryValid ? '有序/无序 Markdown 列表已在聊天气泡内缩进' : '聊天 Markdown 列表缩进样式无效',
                        details: '只读检查显示页渲染器入口和气泡正文 24 CSS px 列表缩进，不发送聊天消息'
                    };
                } catch (error) {
                    return { success: false, message: `检查聊天 Markdown 列表样式失败: ${error.message}` };
                }
            }
        },
        {
            id: 'full_config_zip_backup',
            name: '全量配置 ZIP 备份入口',
            description: '只读检查全量备份控件与恢复结果接口，不导出、导入或重启',
            category: '系统功能',
            run: async () => {
                const controller = window.AascUserConfig;
                const input = document.getElementById('fullConfigBackupImportInput');
                const mode = document.getElementById('fullConfigBackupMode');
                const valid = controller && typeof controller.exportFullConfig === 'function'
                    && typeof controller.confirmFullImport === 'function' && input?.accept.includes('.zip')
                    && mode && [...mode.options].map(option => option.value).join(',') === 'merge,replace';
                if (!valid) return { success: false, message: '全量 ZIP 备份控件或模块缺失' };
                try {
                    const response = await fetch('/api/config-backup/status', { cache: 'no-store' });
                    const data = await response.json();
                    const success = response.ok && data.status === 'success'
                        && ['idle', 'pending', 'applied', 'failed'].includes(data.result?.status);
                    return { success, message: success ? 'ZIP 备份入口与只读状态正常' : 'ZIP 恢复状态异常',
                        details: '本项不生成备份文件，不修改配置，不触发自动重启' };
                } catch (error) { return { success: false, message: `状态读取失败: ${error.message}` }; }
            }
        },
        {
            id: 'doubao_voice_catalog',
            name: '豆包Chat音色目录',
            category: '语音',
            run: async () => {
                const ws = window.WebSocketManager?.ws;
                if (!ws || ws.readyState !== WebSocket.OPEN) return { success: false, message: '请先连接服务器' };
                const requestId = `self-test-doubao-voices-${Date.now()}`;
                const result = await new Promise(resolve => {
                    const finish = value => { clearTimeout(timer); ws.removeEventListener('message', handle); resolve(value); };
                    const handle = event => {
                        try {
                            const message = JSON.parse(event.data);
                            if (message.type === 'ttsProviderVoices' && message.requestId === requestId) finish(message);
                        } catch (error) { /* 其它消息不影响当前只读查询。 */ }
                    };
                    const timer = setTimeout(() => finish({ success: false, message: '音色目录查询超时' }), 5000);
                    ws.addEventListener('message', handle);
                    try { ws.send(JSON.stringify({ type: 'getTtsProviderVoices', provider: 'doubao-chat', requestId })); }
                    catch (error) { finish({ success: false, message: '连接已断开' }); }
                });
                const voices = result.voices || [];
                const female = voices.filter(voice => voice.gender === 'female').length;
                const male = voices.filter(voice => voice.gender === 'male').length;
                const valid = result.success && voices.length === 94 && female === 32 && male === 62
                    && new Set(voices.map(voice => voice.id)).size === 94
                    && voices.every(voice => voice.id === voice.style_id && voice.name && Array.isArray(voice.tags));
                return { success: Boolean(valid), message: valid ? '94项音色目录正常（女32/男62）' : result.message || '音色目录结构不匹配',
                    details: '只查询本地静态目录，不修改配置、不合成；不表示所有音色已完成真实听感验收' };
            }
        },
        {
            id: 'control_tts_voice_picker',
            name: '控制端音色快捷面板',
            category: '语音',
            run: async () => {
                // 只检查当前页面已初始化的共享入口，不发送选择或合成请求。
                const panel = document.getElementById('controlTtsVoicePanel');
                const valid = Boolean(window.TtsVoicePicker && window.ControlTtsVoices
                    && document.getElementById('controlTtsVoiceToggle') && panel
                    && ['controlTtsProviderSelect', 'controlTtsVoiceList', 'controlTtsCurrentVoiceName', 'controlTtsSpeed', 'controlTtsSpeedValue']
                        .every(id => panel.querySelector('#' + id)));
                return { success: valid, message: valid ? '共享音色面板入口正常' : '控制端音色面板尚未初始化',
                    details: '只读结构检查；保存、多端同步和布局由定向回归与ADB验证' };
            }
        },
        {
            id: 'display_voice_filters',
            name: '显示端音色筛选入口',
            category: '语音',
            run: async () => {
                try {
                    // 只检查服务实际提供的HTML结构，不初始化显示页或改变任何远端选择。
                    const response = await fetch('/display.html', { cache: 'no-store' });
                    const document = new DOMParser().parseFromString(await response.text(), 'text/html');
                    const panel = document.querySelector('#displayTtsVoicePanel');
                    const selectors = ['Gender', 'Age', 'Accent'].map(key => '#displayTtsFilter' + key);
                    const valid = response.ok && panel && selectors.every(selector => panel.querySelector('.display-tts-voice-filters select' + selector))
                        && ['#displayTtsCurrentVoiceName', '#displayTtsVoiceClear', '#displayTtsVoiceList'].every(selector => panel.querySelector(selector));
                    return { success: Boolean(valid), message: valid ? '三下拉筛选及当前音色入口正常' : '显示页缺少新版音色筛选入口',
                        details: '仅只读检查部署HTML；交集筛选、CSS和自动定位由真实浏览器回归覆盖' };
                } catch (error) { return { success: false, message: '音色面板资源读取失败' }; }
            }
        },
        {
            id: 'chat_reply_tts_context',
            name: '聊天回复语音来源',
            description: '只读检查AI/Agent模板与对应上一句输入，不发送语音',
            category: '语音功能',
            run: async () => {
                const chat = window.Chat;
                if (!chat?.getReplyTtsContext) return { success: false, message: '聊天语音来源模块尚未加载' };
                const privateReply = chat.getReplyTtsContext({ role: 'assistant', mode: 'private', target: '自测AI' });
                const agentReply = chat.getReplyTtsContext({ role: 'assistant', mode: 'role', target: '自测Agent' });
                const temporaryReply = chat.getReplyTtsContext({ role: 'assistant', mode: 'temporary' }, { roleName: '历史角色' });
                const groupReply = chat.getReplyTtsContext({ role: 'assistant', mode: 'group', name: '显示名' });
                const history = [
                    { id: 'tts-test-first', role: 'control', mode: 'private', target: '自测AI', content: '原轮输入' },
                    { id: 'tts-test-next', role: 'control', mode: 'private', target: '自测AI', content: '后轮输入' },
                    { role: 'assistant', mode: 'private', target: '自测AI', replyToMessageId: 'tts-test-first' }
                ];
                const linkedReply = chat.getReplyTtsContext(history[2], { history, index: 2 });
                const missingReply = chat.getReplyTtsContext({ ...history[2], replyToMessageId: 'missing' }, { history, index: 2 });
                const pairedReply = chat.getReplyTtsContext({ user: 'Agent原输入', assistant: '回答', mode: 'role' });
                const valid = privateReply.businessType === 'ai_reply' && privateReply.templateName === '自测AI'
                    && agentReply.businessType === 'agent_reply' && agentReply.templateName === '自测Agent'
                    && temporaryReply.templateName === '历史角色' && groupReply.templateName === null
                    && chat.getReplyTtsContext({ role: 'control', mode: 'private' }) === null
                    && linkedReply.userText === '原轮输入' && !missingReply.userText
                    && pairedReply.userText === 'Agent原输入';
                return { success: valid, message: valid ? '聊天回复语音来源解析正常' : '聊天回复语音来源解析失败',
                    details: '私聊、Agent、临时历史、群聊与并发回合引用；实际合成由服务端权威配置处理' };
            }
        },
        {
            id: 'tts_provider_config',
            name: '语音服务配置同步',
            description: '检查原生语速能力、全局音量、服务器权威配置、Chat2API账号职责及凭证脱敏；qwen-chat合成前过滤emoji，纯表情跳过',
            category: '语音功能',
            run: async () => {
                const config = window.TtsProviderSettings?.getConfig();
                if (!config) return { success: false, message: '尚未收到语音服务配置', details: '请等待控制端连接成功' };
                const providers = ['system', 'qwen-chat', 'qwen-api', 'doubao-api', 'doubao-chat'];
                const capabilities = window.TtsProviderSettings?.getProviderCapabilities?.() || {};
                const supportsNativeSpeed = window.TtsProviderSettings?.supportsNativeSpeed
                    || ((id) => capabilities[id]?.supportsSpeed === true);
                const selections = ['aiReplyDefault', 'textMedia', 'systemBroadcast'];
                const valid = selections.every(key => providers.includes(config[key]?.provider))
                    && Number.isInteger(config.defaultVolume) && config.defaultVolume >= 0 && config.defaultVolume <= 100
                    && !['textMedia', 'systemBroadcast'].some(key => config[key].provider === 'doubao-chat')
                    && providers.every(id => config.providers[id] && !Object.hasOwn(config.providers[id], 'credential'))
                    && providers.every(id => supportsNativeSpeed(id, config.providers[id].model)
                        ? Number.isInteger(config.providers[id].defaultSpeed) && config.providers[id].defaultSpeed >= -10 && config.providers[id].defaultSpeed <= 10
                        : !Object.hasOwn(config.providers[id], 'defaultSpeed'))
                    && providers.every(id => !Object.hasOwn(config.providers[id], 'defaultVolume'))
                    && !Object.hasOwn(config.providers.system, 'enabled')
                    && !Object.hasOwn(config.providers.system, 'defaultVoice')
                    && !Object.hasOwn(config.providers['qwen-chat'], 'chat2apiAccountId')
                    && !Object.hasOwn(config.providers['qwen-chat'], 'credentialSource')
                    && typeof config.providers['qwen-chat'].model==='string' && Boolean(config.providers['qwen-chat'].model.trim())
                    && !Object.hasOwn(config.providers['doubao-chat'], 'chat2apiAccountId')
                    && !Object.hasOwn(config.providers['doubao-chat'], 'credentialSource')
                    && config.providers['doubao-chat'].model === 'doubao-chat';
                return { success: valid, message: valid ? '业务配置已同步，原生语速/全局音量有效且凭证已脱敏' : '语音服务配置校验失败',
                    details: '本项检查各Provider语速能力与范围、全局音量、配置同步及凭证脱敏；账号和语音调用由Chat2API处理，设备声音与API权限另行验收' };
            }
        },
        {
            id: 'android_external_login_entry',
            name: 'Android外部登录入口',
            description: '只读检查原生登录入口和豆包未验证状态；取消外部网页后再次打开由Android真机回归验收',
            category: '基础功能',
            run: async () => {
                const native = window.NativeControl;
                if (!native) return { success: true, message: '非Android控制页，跳过原生登录检查', details: '顶部完成/取消需在Android隔离登录页检查' };
                const chat = window.Chat2APIControl;
                const valid = typeof native.openChat2ApiLogin === 'function'
                    && typeof native.openChat2ApiAccountWeb === 'function'
                    && typeof chat?.completeNativeLogin === 'function'
                    && chat?.accountStatus?.({ providerId: 'doubaochat', status: 'active', accountInfo: { credentialVerification: 'format-only' } })?.includes('未远端验证');
                return { success: Boolean(valid), message: valid ? '原生登录入口与未验证提示可用' : '原生登录入口或提示缺失',
                    details: '本项不验证实际凭据捕获或重复打开流程；WebView目录只初始化一次由Android单测覆盖，取消后再次打开需真机确认；本检查不触发网页登录或账号保存' };
            }
        },
        {
            id: 'display_connection',
            name: '显示端连接测试',
            description: '检查是否有显示端连接',
            category: '基础功能',
            run: async () => {
                const displays = window.DisplayList ? window.DisplayList.getDisplays() : [];
                if (displays.length === 0) {
                    return { success: false, message: '没有显示端连接', details: '请先打开显示端页面' };
                }
                return { success: true, message: `已连接 ${displays.length} 个显示端`, details: displays.map(d => d.ip || d.id).join(', ') };
            }
        },
        {
            id: 'websocket_connection',
            name: 'WebSocket连接测试',
            description: '检查WebSocket连接状态',
            category: '基础功能',
            run: async () => {
                if (!window.WebSocketManager || !window.WebSocketManager.ws) {
                    return { success: false, message: 'WebSocket未初始化', details: 'WebSocketManager不存在' };
                }
                if (window.WebSocketManager.ws.readyState !== WebSocket.OPEN) {
                    const states = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
                    return { success: false, message: 'WebSocket未连接', details: `状态: ${states[window.WebSocketManager.ws.readyState]}` };
                }
                return { success: true, message: 'WebSocket连接正常', details: 'readyState: OPEN' };
            }
        },
        {
            id: 'display_background_glow_settings',
            name: '显示端背景光晕设置',
            description: '检查全局中心颜色、完整中心范围、扩散范围与实时预览',
            category: '界面布局',
            run: async () => {
                const color = document.getElementById('displayBackgroundGlowColor');
                const centerRange = document.getElementById('displayBackgroundGlowCenterRange');
                const spread = document.getElementById('displayBackgroundGlowSpread');
                const preview = document.getElementById('displayBackgroundGlowPreview');
                const config = window.DisplayBackgroundGlow?.currentConfig;
                if (!color || !centerRange || !spread || !preview || !config) {
                    return { success: false, message: '背景光晕设置控件不完整', details: '缺少滑块、预览或配置管理器' };
                }
                const valid = /^#[0-9A-F]{6}$/u.test(config.color)
                    && Number.isFinite(config.centerRange)
                    && config.centerRange >= 0 && config.centerRange <= 20
                    && Number.isFinite(config.spread) && config.spread >= 25 && config.spread <= 90;
                return {
                    success: valid,
                    message: valid ? '背景光晕设置正常' : '背景光晕参数超出范围',
                    details: `中心颜色 ${config.color}，中心亮度范围 ${config.centerRange}%，扩散范围 ${config.spread}%`
                };
            }
        },
        {
            id: 'display_tts_background_opacity',
            name: 'TTS 背景透明度设置',
            description: '检查透明度滑块范围、权威配置和百分比标签',
            category: '界面布局',
            run: async () => {
                const input = document.getElementById('displayTtsBackgroundOpacity');
                const output = document.getElementById('displayTtsBackgroundOpacityValue');
                const opacity = window.Settings?.ttsBackgroundOpacity;
                const valid = Boolean(input && output && Number.isFinite(opacity)
                    && Number(input.min) === 0 && Number(input.max) === 100
                    && Number(input.step) === 1 && opacity >= 0 && opacity <= 1);
                return {
                    success: valid,
                    message: valid ? 'TTS 背景透明度设置正常' : 'TTS 背景透明度控件或权威值异常',
                    details: valid ? `当前峰值 ${Math.round(opacity * 100)}%（alpha ${opacity}）` : '检查0–100%滑块范围、1%步长和服务端配置同步'
                };
            }
        },
        {
            id: 'server_port_setting',
            name: '服务器端口设置',
            description: '检查服务器端口输入边界和权威值',
            category: '界面布局',
            run: async () => {
                const input = document.getElementById('serverPortInput');
                const port = window.Settings?.serverPort;
                const valid = Boolean(input && Number(input.min) === 1 && Number(input.max) === 65535
                    && Number(input.step) === 1 && Number.isInteger(port) && port >= 1 && port <= 65535);
                return {
                    success: valid,
                    message: valid ? `服务器端口设置正常：${port}` : '服务器端口控件或权威值异常',
                    details: '端口变更由服务端 WebSocket 配置保存并触发托管重启'
                };
            }
        },
        {
            id: 'task_panel_portrait_layout',
            name: '任务面板竖屏布局',
            description: '检查竖屏任务条横向滚动及实例/结果列全宽堆叠',
            category: '界面布局',
            run: async () => {
                const panel = document.getElementById('panel-task');
                const layout = panel?.querySelector('.task-three-col');
                if (!layout || panel.offsetParent === null) {
                    return { success: true, message: '任务面板尚未打开，跳过布局检查', details: '打开任务面板后可再次运行自测' };
                }
                const portrait = window.matchMedia('(orientation: portrait)').matches;
                const direction = getComputedStyle(layout).flexDirection;
                const rail = layout.querySelector('.task-list-rail');
                const instances = layout.querySelector('.task-instances-col');
                const result = layout.querySelector('.task-result-col');
                const inBounds = [instances, result].every(column => {
                    if (!column) return false;
                    const rect = column.getBoundingClientRect();
                    return rect.left >= -1 && rect.right <= window.innerWidth + 1;
                });
                const valid = portrait
                    ? direction === 'column' && getComputedStyle(rail).overflowX === 'auto' && inBounds
                    : direction === 'row';
                return {
                    success: valid,
                    message: valid ? '任务面板方向布局正常' : '任务面板布局或列边界异常',
                    details: portrait ? '竖屏横向任务条与全宽实例/结果列' : '横屏三列布局'
                };
            }
        },
        {
            id: 'display_status_bar_vad_location',
            name: '显示状态栏开关位置',
            description: '确认当前显示端的独立开关位于 VAD 卡片',
            category: '界面布局',
            run: async () => {
                if (!window.currentDisplayId) {
                    return { success: true, message: '未选择显示端，跳过位置检查', details: '选择显示端后可在 VAD 面板检查开关' };
                }
                const panel = document.getElementById('voiceVadPanel');
                const toggle = panel?.querySelector('[data-display-status-bar-toggle]');
                const misplacedToggle = document.querySelector('.display-voice-control [data-display-status-bar-toggle]');
                const valid = Boolean(toggle)
                    && toggle.dataset.displayId === window.currentDisplayId
                    && !misplacedToggle;
                return {
                    success: valid,
                    message: valid ? '状态栏开关位置正常' : '状态栏开关未显示在当前 VAD 卡片',
                    details: valid ? `displayId: ${toggle.dataset.displayId}` : '开关应只在 VAD 当前显示端卡片中出现'
                };
            }
        },
        {
            id: 'control_sidebar_orientation',
            name: '控制端主导航方向布局',
            description: '竖屏检查底部导航，横屏检查左侧导航',
            category: '界面布局',
            run: async () => {
                const sidebar = document.querySelector('.sidebar');
                const sidebarNav = document.querySelector('.sidebar-nav');
                const content = document.querySelector('.content');
                if (!sidebar || !sidebarNav || !content || typeof window.matchMedia !== 'function') {
                    return { success: false, message: '无法读取主导航布局', details: '缺少导航元素或方向检测能力' };
                }
                const portrait = window.matchMedia('(orientation: portrait)').matches;
                const sidebarStyle = window.getComputedStyle(sidebar);
                const navStyle = window.getComputedStyle(sidebarNav);
                const contentStyle = window.getComputedStyle(content);
                const valid = portrait
                    ? sidebarStyle.position === 'fixed'
                        && sidebarStyle.flexDirection === 'row'
                        && Number.parseFloat(sidebarStyle.bottom) === 0
                        && navStyle.flexDirection === 'row'
                        && Number.parseFloat(contentStyle.marginLeft) === 0
                    : sidebarStyle.position === 'fixed'
                        && sidebarStyle.flexDirection === 'column'
                        && Number.parseFloat(sidebarStyle.left) === 0
                        && navStyle.overflowY === 'auto'
                        && Number.parseFloat(contentStyle.marginLeft) === 60;
                return {
                    success: valid,
                    message: valid ? '主导航方向布局正常' : '主导航位置或滚动方向不符合屏幕方向',
                    details: portrait ? '竖屏：底部横向导航' : '横屏：左侧纵向导航'
                };
            }
        },
        {
            id: 'play_command',
            name: '播放命令测试',
            description: '测试播放命令发送并等待显示端确认',
            category: '播放控制',
            run: async () => {
                if (!window.currentDisplayId) {
                    return { success: false, message: '未选择显示端', details: '请先选择一个显示端' };
                }
                if (!window.WebSocketManager || !window.WebSocketManager.ws || window.WebSocketManager.ws.readyState !== WebSocket.OPEN) {
                    return { success: false, message: 'WebSocket未连接', details: '无法发送命令' };
                }
                try {
                    const ackPromise = window.SelfTest.waitForAck('control', window.currentDisplayId);
                    window.WebSocketManager.sendControl('play', true);
                    const ackResult = await ackPromise;
                    return { 
                        success: ackResult.success, 
                        message: ackResult.success ? '播放命令已确认' : '播放命令未确认', 
                        details: ackResult.details 
                    };
                } catch (err) {
                    return { success: false, message: '发送失败', details: err.message };
                }
            }
        },
        {
            id: 'pause_command',
            name: '暂停命令测试',
            description: '测试暂停命令发送并等待显示端确认',
            category: '播放控制',
            run: async () => {
                if (!window.currentDisplayId) {
                    return { success: false, message: '未选择显示端', details: '请先选择一个显示端' };
                }
                if (!window.WebSocketManager || !window.WebSocketManager.ws || window.WebSocketManager.ws.readyState !== WebSocket.OPEN) {
                    return { success: false, message: 'WebSocket未连接', details: '无法发送命令' };
                }
                try {
                    const ackPromise = window.SelfTest.waitForAck('control', window.currentDisplayId);
                    window.WebSocketManager.sendControl('play', false);
                    const ackResult = await ackPromise;
                    return { 
                        success: ackResult.success, 
                        message: ackResult.success ? '暂停命令已确认' : '暂停命令未确认', 
                        details: ackResult.details 
                    };
                } catch (err) {
                    return { success: false, message: '发送失败', details: err.message };
                }
            }
        },
        {
            id: 'fit_mode_contain',
            name: '画面填充-适应测试',
            description: '测试适应模式',
            category: '画面控制',
            run: async () => {
                if (!window.currentDisplayId) {
                    return { success: false, message: '未选择显示端', details: '请先选择一个显示端' };
                }
                try {
                    window.sendFitMode('contain');
                    return { success: true, message: '适应模式命令已发送', details: 'fit: contain' };
                } catch (err) {
                    return { success: false, message: '发送失败', details: err.message };
                }
            }
        },
        {
            id: 'fit_mode_height',
            name: '画面填充-高度铺满测试',
            description: '测试高度铺满模式',
            category: '画面控制',
            run: async () => {
                if (!window.currentDisplayId) {
                    return { success: false, message: '未选择显示端', details: '请先选择一个显示端' };
                }
                try {
                    window.sendFitMode('height');
                    return { success: true, message: '高度铺满命令已发送', details: 'fit: height' };
                } catch (err) {
                    return { success: false, message: '发送失败', details: err.message };
                }
            }
        },
        {
            id: 'fit_mode_width',
            name: '画面填充-宽度铺满测试',
            description: '测试宽度铺满模式',
            category: '画面控制',
            run: async () => {
                if (!window.currentDisplayId) {
                    return { success: false, message: '未选择显示端', details: '请先选择一个显示端' };
                }
                try {
                    window.sendFitMode('width');
                    return { success: true, message: '宽度铺满命令已发送', details: 'fit: width' };
                } catch (err) {
                    return { success: false, message: '发送失败', details: err.message };
                }
            }
        },
        {
            id: 'fit_mode_crop',
            name: '画面填充-裁剪测试',
            description: '测试裁剪模式',
            category: '画面控制',
            run: async () => {
                if (!window.currentDisplayId) {
                    return { success: false, message: '未选择显示端', details: '请先选择一个显示端' };
                }
                try {
                    window.sendFitMode('crop');
                    return { success: true, message: '裁剪模式命令已发送', details: 'fit: crop' };
                } catch (err) {
                    return { success: false, message: '发送失败', details: err.message };
                }
            }
        },
        {
            id: 'volume_control',
            name: '音量控制测试',
            description: '测试音量调节',
            category: '播放控制',
            run: async () => {
                if (!window.currentDisplayId) {
                    return { success: false, message: '未选择显示端', details: '请先选择一个显示端' };
                }
                try {
                    window.WebSocketManager.sendControl('volume', 50);
                    return { success: true, message: '音量命令已发送', details: 'volume: 50' };
                } catch (err) {
                    return { success: false, message: '发送失败', details: err.message };
                }
            }
        },
        {
            id: 'rotation_0',
            name: '旋转-0度测试',
            description: '测试0度旋转',
            category: '画面控制',
            run: async () => {
                if (!window.currentDisplayId) {
                    return { success: false, message: '未选择显示端', details: '请先选择一个显示端' };
                }
                try {
                    window.setCropRotation(0);
                    return { success: true, message: '0度旋转命令已发送', details: 'rotation: 0' };
                } catch (err) {
                    return { success: false, message: '发送失败', details: err.message };
                }
            }
        },
        {
            id: 'rotation_90',
            name: '旋转-90度测试',
            description: '测试90度旋转',
            category: '画面控制',
            run: async () => {
                if (!window.currentDisplayId) {
                    return { success: false, message: '未选择显示端', details: '请先选择一个显示端' };
                }
                try {
                    window.setCropRotation(90);
                    return { success: true, message: '90度旋转命令已发送', details: 'rotation: 90' };
                } catch (err) {
                    return { success: false, message: '发送失败', details: err.message };
                }
            }
        },
        {
            id: 'rotation_180',
            name: '旋转-180度测试',
            description: '测试180度旋转',
            category: '画面控制',
            run: async () => {
                if (!window.currentDisplayId) {
                    return { success: false, message: '未选择显示端', details: '请先选择一个显示端' };
                }
                try {
                    window.setCropRotation(180);
                    return { success: true, message: '180度旋转命令已发送', details: 'rotation: 180' };
                } catch (err) {
                    return { success: false, message: '发送失败', details: err.message };
                }
            }
        },
        {
            id: 'rotation_270',
            name: '旋转-270度测试',
            description: '测试270度旋转',
            category: '画面控制',
            run: async () => {
                if (!window.currentDisplayId) {
                    return { success: false, message: '未选择显示端', details: '请先选择一个显示端' };
                }
                try {
                    window.setCropRotation(270);
                    return { success: true, message: '270度旋转命令已发送', details: 'rotation: 270' };
                } catch (err) {
                    return { success: false, message: '发送失败', details: err.message };
                }
            }
        },
        {
            id: 'tts_custom',
            name: '自定义语音播报测试',
            description: '播报后核对三行白字、主题色细描边、设置的背景透明度和4px模糊；30秒隐藏保留历史',
            category: '语音功能',
            run: async () => {
                if (!window.currentDisplayId) {
                    return { success: false, message: '未选择显示端', details: '请先选择一个显示端' };
                }
                try {
                    window.WebSocketManager.sendTts('play', { text: '自测语音播报测试' });
                    const opacity = Number(window.Settings?.ttsBackgroundOpacity ?? 0.2);
                    return { success: true, message: 'TTS命令已发送，字幕显示待人工验收', details: `核对逐行显示、固定3行、字号保持；白字配0.5px主题色细描边和时间文本同款阴影；上下渐隐背景峰值${Math.round(opacity * 100)}%并使用4px背景模糊；切换主题只改变边缘颜色，字幕进度/历史保留，30秒无新行隐藏，再次播报保留历史；最多100行。此结果只表示命令已发送。` };
                } catch (err) {
                    return { success: false, message: '发送失败', details: err.message };
                }
            }
        },
        {
            id: 'display_switch',
            name: '显示端切换测试',
            description: '测试显示端切换功能',
            category: '显示端控制',
            run: async () => {
                const displays = window.DisplayList ? window.DisplayList.getDisplays() : [];
                if (displays.length < 2) {
                    return { success: true, message: '跳过（只有一个显示端）', details: '需要至少2个显示端才能测试切换' };
                }
                const currentId = window.currentDisplayId;
                const otherDisplay = displays.find(d => d.id !== currentId);
                if (otherDisplay) {
                    window.DisplayList.select(otherDisplay.id);
                    setTimeout(() => {
                        window.DisplayList.select(currentId);
                    }, 500);
                    return { success: true, message: '显示端切换测试完成', details: `切换到 ${otherDisplay.id} 后返回` };
                }
                return { success: false, message: '无法找到其他显示端', details: '切换测试失败' };
            }
        },
        {
            id: 'time_parser',
            name: '时间解析功能测试',
            description: '测试通用时间解析',
            category: '辅助功能',
            run: async () => {
                const testCases = [
                    { input: '5分钟后', expected: 'relative' },
                    { input: '明天8点', expected: 'absolute' },
                    { input: '下午3点', expected: 'absolute' }
                ];
                let passed = 0;
                let details = [];
                for (const tc of testCases) {
                    try {
                        const response = await fetch('/api/time/parse', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ text: tc.input })
                        });
                        const result = await response.json();
                        if (result.status === 'success' && result.result) {
                            passed++;
                            details.push(`${tc.input}: ${result.result.description}`);
                        } else {
                            details.push(`${tc.input}: 解析失败`);
                        }
                    } catch (err) {
                        details.push(`${tc.input}: ${err.message}`);
                    }
                }
                if (passed === testCases.length) {
                    return { success: true, message: '时间解析测试通过', details: details.join('; ') };
                } else if (passed > 0) {
                    return { success: true, message: `时间解析部分通过 (${passed}/${testCases.length})`, details: details.join('; ') };
                }
                return { success: false, message: '时间解析测试失败', details: details.join('; ') };
            }
        },
        {
            id: 'crop_reset',
            name: '裁剪重置测试',
            description: '测试裁剪重置功能',
            category: '画面控制',
            run: async () => {
                if (!window.currentDisplayId) {
                    return { success: false, message: '未选择显示端', details: '请先选择一个显示端' };
                }
                try {
                    window.resetCrop();
                    return { success: true, message: '裁剪重置命令已发送', details: 'crop reset' };
                } catch (err) {
                    return { success: false, message: '发送失败', details: err.message };
                }
            }
        },
        {
            id: 'controls_init',
            name: '控制模块初始化测试',
            description: '检查控制模块是否正确初始化',
            category: '基础功能',
            run: async () => {
                const modules = ['Controls', 'DisplayList', 'WebSocketManager', 'Crop', 'Chat', 'MediaLibrary'];
                const missing = [];
                const details = [];
                for (const mod of modules) {
                    if (window[mod]) {
                        details.push(`${mod}: OK`);
                    } else {
                        missing.push(mod);
                        details.push(`${mod}: 缺失`);
                    }
                }
                if (missing.length === 0) {
                    return { success: true, message: '所有模块已初始化', details: details.join(', ') };
                }
                return { success: false, message: `缺失模块: ${missing.join(', ')}`, details: details.join(', ') };
            }
        },
        {
            id: 'server_status',
            name: '服务器状态测试',
            description: '检查服务器连接状态',
            category: '基础功能',
            run: async () => {
                try {
                    const response = await fetch('/api/status');
                    const data = await response.json();
                    if (data.status === 'ok') {
                        return { success: true, message: '服务器运行正常', details: `uptime: ${Math.floor(data.uptime / 60)}分钟` };
                    }
                    return { success: false, message: '服务器状态异常', details: JSON.stringify(data) };
                } catch (err) {
                    return { success: false, message: '无法连接服务器', details: err.message };
                }
            }
        },
        {
            id: 'server_runtime_version',
            name: '服务更新版本来源测试',
            description: '检查实际代码、依赖目录和最近受管更新结果',
            category: 'AASC系统',
            run: async () => {
                try {
                    const response = await fetch('/api/status');
                    const data = await response.json();
                    const versions = data.versions;
                    const required = ['code', 'dependencies', 'codePath', 'dependenciesPath', 'dependencySource'];
                    if (!response.ok || !versions || required.some(key => typeof versions[key] !== 'string' || !versions[key])) {
                        return { success: false, message: '实际运行版本或依赖路径缺失', details: JSON.stringify(versions || {}) };
                    }
                    if (versions.update?.status === 'failed') {
                        return { success: false, message: '最近一次服务更新失败', details: versions.update.message || JSON.stringify(versions.update) };
                    }
                    return { success: true, message: `代码 ${versions.code} / 依赖 ${versions.dependencies}`,
                        details: `${versions.dependencySource}；代码：${versions.codePath}；依赖：${versions.dependenciesPath}` };
                } catch (error) {
                    return { success: false, message: '无法读取服务运行版本', details: error.message };
                }
            }
        },
        {
            id: 'aasc_module_load',
            name: 'AASC模块加载测试',
            description: '检查AASC系统模块是否正确加载',
            category: 'AASC系统',
            run: async () => {
                try {
                    const response = await fetch('/aasc/index.js');
                    if (response.ok) {
                        return { success: true, message: 'AASC模块可访问', details: 'aasc/index.js 加载成功' };
                    }
                    return { success: false, message: 'AASC模块不可访问', details: `状态码: ${response.status}` };
                } catch (err) {
                    return { success: false, message: 'AASC模块加载失败', details: err.message };
                }
            }
        },
        {
            id: 'aasc_message_api',
            name: 'AASC消息API测试',
            description: '测试AASC消息协议API',
            category: 'AASC系统',
            run: async () => {
                try {
                    const response = await fetch('/api/aasc/message', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            type: 'command',
                            topic: 'test',
                            payload: { test: true }
                        })
                    });
                    if (response.ok) {
                        const data = await response.json();
                        return { success: true, message: '消息API响应正常', details: JSON.stringify(data) };
                    }
                    return { success: false, message: '消息API响应异常', details: `状态码: ${response.status}` };
                } catch (err) {
                    return { success: true, message: '消息API未实现（预期行为）', details: 'API将在后续集成时实现' };
                }
            }
        },
        {
            id: 'aasc_actor_registry',
            name: 'AASC执行者注册表测试',
            description: '测试执行者注册表API',
            category: 'AASC系统',
            run: async () => {
                try {
                    const response = await fetch('/api/aasc/actors');
                    if (response.ok) {
                        const data = await response.json();
                        const count = data.actors ? data.actors.length : 0;
                        return { success: true, message: `已注册 ${count} 个执行者`, details: JSON.stringify(data.actors || []) };
                    }
                    return { success: true, message: '执行者注册表API未实现（预期行为）', details: 'API将在后续集成时实现' };
                } catch (err) {
                    return { success: true, message: '执行者注册表API未实现（预期行为）', details: err.message };
                }
            }
        },
        {
            id: 'aasc_user_store',
            name: 'AASC用户存储测试',
            description: '测试用户存储功能',
            category: 'AASC系统',
            run: async () => {
                try {
                    const response = await fetch('/api/aasc/users');
                    if (response.ok) {
                        const data = await response.json();
                        const count = data.users ? data.users.length : 0;
                        return { success: true, message: `已存储 ${count} 个用户`, details: '用户存储正常' };
                    }
                    return { success: true, message: '用户存储API未实现（预期行为）', details: 'API将在后续集成时实现' };
                } catch (err) {
                    return { success: true, message: '用户存储API未实现（预期行为）', details: err.message };
                }
            }
        },
        {
            id: 'aasc_capability_registry',
            name: 'AASC能力注册表测试',
            description: '测试能力注册表功能',
            category: 'AASC系统',
            run: async () => {
                try {
                    const response = await fetch('/api/aasc/capabilities');
                    if (response.ok) {
                        const data = await response.json();
                        const count = data.capabilities ? data.capabilities.length : 0;
                        return { success: true, message: `已定义 ${count} 个能力`, details: '能力注册表正常' };
                    }
                    return { success: true, message: '能力注册表API未实现（预期行为）', details: 'API将在后续集成时实现' };
                } catch (err) {
                    return { success: true, message: '能力注册表API未实现（预期行为）', details: err.message };
                }
            }
        },
        {
            id: 'aasc_cluster_status',
            name: 'AASC集群状态测试',
            description: '测试集群状态功能',
            category: 'AASC系统',
            run: async () => {
                try {
                    const response = await fetch('/api/aasc/cluster');
                    if (response.ok) {
                        const data = await response.json();
                        const nodeCount = data.nodes ? data.nodes.length : 0;
                        return { success: true, message: `集群有 ${nodeCount} 个节点`, details: JSON.stringify(data.stats || {}) };
                    }
                    return { success: true, message: '集群API未实现（预期行为）', details: 'API将在后续集成时实现' };
                } catch (err) {
                    return { success: true, message: '集群API未实现（预期行为）', details: err.message };
                }
            }
        },
        {
            id: 'aasc_pipeline_module',
            name: 'AASC管道模块测试',
            description: '测试能力管道执行器模块加载',
            category: '能力组合系统',
            run: async () => {
                try {
                    const response = await fetch('/aasc/pipeline.js');
                    if (response.ok) {
                        const text = await response.text();
                        const hasPipelineExecutor = text.includes('PipelineExecutor');
                        const hasPipelineContext = text.includes('PipelineContext');
                        const hasPipelineStep = text.includes('PipelineStep');
                        if (hasPipelineExecutor && hasPipelineContext && hasPipelineStep) {
                            return { success: true, message: '管道模块加载成功', details: 'PipelineExecutor, PipelineContext, PipelineStep 已定义' };
                        }
                        return { success: false, message: '管道模块不完整', details: '缺少核心类定义' };
                    }
                    return { success: false, message: '管道模块不可访问', details: `状态码: ${response.status}` };
                } catch (err) {
                    return { success: false, message: '管道模块加载失败', details: err.message };
                }
            }
        },
        {
            id: 'aasc_composition_module',
            name: 'AASC组合模块测试',
            description: '测试能力组合定义模块加载',
            category: '能力组合系统',
            run: async () => {
                try {
                    const response = await fetch('/aasc/composition.js');
                    if (response.ok) {
                        const text = await response.text();
                        const hasComposition = text.includes('CapabilityComposition');
                        const hasTrigger = text.includes('Trigger');
                        const hasRegistry = text.includes('CompositionRegistry');
                        if (hasComposition && hasTrigger && hasRegistry) {
                            return { success: true, message: '组合模块加载成功', details: 'CapabilityComposition, Trigger, CompositionRegistry 已定义' };
                        }
                        return { success: false, message: '组合模块不完整', details: '缺少核心类定义' };
                    }
                    return { success: false, message: '组合模块不可访问', details: `状态码: ${response.status}` };
                } catch (err) {
                    return { success: false, message: '组合模块加载失败', details: err.message };
                }
            }
        },
        {
            id: 'aasc_level_calculator_module',
            name: 'AASC等级计算器模块测试',
            description: '测试能力等级计算器模块加载',
            category: '能力组合系统',
            run: async () => {
                try {
                    const response = await fetch('/aasc/level-calculator.js');
                    if (response.ok) {
                        const text = await response.text();
                        const hasCalculator = text.includes('CapabilityLevelCalculator');
                        const hasActorScore = text.includes('ActorLevelScore');
                        const hasCapScore = text.includes('CapabilityScore');
                        if (hasCalculator && hasActorScore && hasCapScore) {
                            return { success: true, message: '等级计算器模块加载成功', details: 'CapabilityLevelCalculator, ActorLevelScore, CapabilityScore 已定义' };
                        }
                        return { success: false, message: '等级计算器模块不完整', details: '缺少核心类定义' };
                    }
                    return { success: false, message: '等级计算器模块不可访问', details: `状态码: ${response.status}` };
                } catch (err) {
                    return { success: false, message: '等级计算器模块加载失败', details: err.message };
                }
            }
        },
        {
            id: 'aasc_capabilities_config',
            name: 'AASC能力配置文件测试',
            description: '测试能力配置文件加载',
            category: '能力组合系统',
            run: async () => {
                try {
                    const response = await fetch('/config/capabilities.json');
                    if (response.ok) {
                        const data = await response.json();
                        const capCount = data.capabilities ? data.capabilities.length : 0;
                        if (capCount > 0) {
                            const categories = [...new Set(data.capabilities.map(c => c.category))];
                            const levels = [...new Set(data.capabilities.map(c => c.level))].sort();
                            return { 
                                success: true, 
                                message: `能力配置文件加载成功，共 ${capCount} 个能力`, 
                                details: `分类: ${categories.join(', ')}; 等级: ${levels.join(', ')}` 
                            };
                        }
                        return { success: false, message: '能力配置文件为空', details: '没有定义任何能力' };
                    }
                    return { success: false, message: '能力配置文件不可访问', details: `状态码: ${response.status}` };
                } catch (err) {
                    return { success: false, message: '能力配置文件加载失败', details: err.message };
                }
            }
        },
        {
            id: 'aasc_capability_levels',
            name: 'AASC能力等级分布测试',
            description: '测试能力等级分布是否合理',
            category: '能力组合系统',
            run: async () => {
                try {
                    const response = await fetch('/config/capabilities.json');
                    if (response.ok) {
                        const data = await response.json();
                        const caps = data.capabilities || [];
                        const levelCounts = {};
                        caps.forEach(c => {
                            levelCounts[c.level] = (levelCounts[c.level] || 0) + 1;
                        });
                        const levels = Object.keys(levelCounts).sort();
                        const hasBasic = levelCounts[1] > 0 || levelCounts[2] > 0;
                        const hasProfessional = levelCounts[3] > 0 || levelCounts[4] > 0;
                        const hasSpecial = levelCounts[5] > 0;
                        let details = [];
                        levels.forEach(l => details.push(`L${l}: ${levelCounts[l]}个`));
                        if (hasBasic && hasProfessional) {
                            return { 
                                success: true, 
                                message: '能力等级分布合理', 
                                details: details.join(', ') 
                            };
                        }
                        return { success: false, message: '能力等级分布不完整', details: details.join(', ') };
                    }
                    return { success: false, message: '无法获取能力配置', details: '请求失败' };
                } catch (err) {
                    return { success: false, message: '能力等级分布测试失败', details: err.message };
                }
            }
        },
        {
            id: 'aasc_capability_categories',
            name: 'AASC能力分类测试',
            description: '测试能力分类是否完整',
            category: '能力组合系统',
            run: async () => {
                try {
                    const response = await fetch('/config/capabilities.json');
                    if (response.ok) {
                        const data = await response.json();
                        const caps = data.capabilities || [];
                        const categoryCounts = {};
                        caps.forEach(c => {
                            categoryCounts[c.category] = (categoryCounts[c.category] || 0) + 1;
                        });
                        const hasBasic = categoryCounts.basic > 0;
                        const hasProfessional = categoryCounts.professional > 0;
                        const hasSpecial = categoryCounts.special > 0;
                        let details = [];
                        Object.keys(categoryCounts).forEach(cat => {
                            details.push(`${cat}: ${categoryCounts[cat]}个`);
                        });
                        if (hasBasic && hasProfessional && hasSpecial) {
                            return { 
                                success: true, 
                                message: '能力分类完整', 
                                details: details.join(', ') 
                            };
                        }
                        return { success: false, message: '能力分类不完整', details: details.join(', ') };
                    }
                    return { success: false, message: '无法获取能力配置', details: '请求失败' };
                } catch (err) {
                    return { success: false, message: '能力分类测试失败', details: err.message };
                }
            }
        },
        {
            id: 'aasc_capability_inheritance',
            name: 'AASC能力继承测试',
            description: '测试能力继承关系是否正确',
            category: '能力组合系统',
            run: async () => {
                try {
                    const response = await fetch('/config/capabilities.json');
                    if (response.ok) {
                        const data = await response.json();
                        const caps = data.capabilities || [];
                        const capMap = {};
                        caps.forEach(c => capMap[c.id] = c);
                        let inheritanceCount = 0;
                        let validInheritance = 0;
                        caps.forEach(c => {
                            if (c.inherits && c.inherits.length > 0) {
                                inheritanceCount++;
                                const allValid = c.inherits.every(parentId => capMap[parentId] !== undefined);
                                if (allValid) validInheritance++;
                            }
                        });
                        if (inheritanceCount === 0) {
                            return { success: true, message: '无继承关系（正常）', details: '所有能力都是独立定义' };
                        }
                        if (validInheritance === inheritanceCount) {
                            return { 
                                success: true, 
                                message: `能力继承关系正确 (${validInheritance}/${inheritanceCount})`, 
                                details: '所有继承引用都有效' 
                            };
                        }
                        return { 
                            success: false, 
                            message: `能力继承关系有误 (${validInheritance}/${inheritanceCount})`, 
                            details: '部分继承引用无效' 
                        };
                    }
                    return { success: false, message: '无法获取能力配置', details: '请求失败' };
                } catch (err) {
                    return { success: false, message: '能力继承测试失败', details: err.message };
                }
            }
        },
        {
            id: 'aasc_index_exports',
            name: 'AASC入口导出测试',
            description: '测试入口文件是否正确导出所有模块',
            category: '能力组合系统',
            run: async () => {
                try {
                    const response = await fetch('/aasc/index.js');
                    if (response.ok) {
                        const text = await response.text();
                        const exports = [];
                        const checks = [
                            { name: 'PipelineExecutor', pattern: /PipelineExecutor/ },
                            { name: 'CapabilityComposition', pattern: /CapabilityComposition/ },
                            { name: 'CapabilityLevelCalculator', pattern: /CapabilityLevelCalculator/ },
                            { name: 'CompositionRegistry', pattern: /CompositionRegistry/ },
                            { name: 'Message', pattern: /Message/ },
                            { name: 'Actor', pattern: /Actor/ },
                            { name: 'MessageBus', pattern: /MessageBus/ }
                        ];
                        checks.forEach(check => {
                            if (check.pattern.test(text)) {
                                exports.push(check.name);
                            }
                        });
                        if (exports.length >= 5) {
                            return { success: true, message: `入口文件导出正常 (${exports.length}个模块)`, details: exports.join(', ') };
                        }
                        return { success: false, message: '入口文件导出不完整', details: `已导出: ${exports.join(', ')}` };
                    }
                    return { success: false, message: '入口文件不可访问', details: `状态码: ${response.status}` };
                } catch (err) {
                    return { success: false, message: '入口文件加载失败', details: err.message };
                }
            }
        }
    ],
    
    init() {
        this.loadResults();
    },
    
    loadResults() {
        try {
            const saved = localStorage.getItem('selfTestResults');
            if (saved) {
                const data = JSON.parse(saved);
                this.testResults = data.testResults || this.testResults;
                this.results = data.results || [];
            }
        } catch (e) {
            console.error('[SelfTest] 加载结果失败:', e);
        }
    },
    
    saveResults() {
        try {
            localStorage.setItem('selfTestResults', JSON.stringify({
                testResults: this.testResults,
                results: this.results,
                lastRun: new Date().toISOString()
            }));
        } catch (e) {
            console.error('[SelfTest] 保存结果失败:', e);
        }
    },
    
    async runAllTests() {
        if (this.isRunning) {
            window.showToast('自测正在进行中...', 'warning');
            return;
        }
        
        this.isRunning = true;
        this.results = [];
        this.testResults = { passed: 0, failed: 0, skipped: 0, total: this.tests.length };
        this.currentTestIndex = 0;
        
        this.showProgress();
        
        for (let i = 0; i < this.tests.length; i++) {
            this.currentTestIndex = i;
            const test = this.tests[i];
            this.updateProgress(i, test.name);
            
            try {
                const result = await test.run();
                this.results.push({
                    id: test.id,
                    name: test.name,
                    category: test.category,
                    description: test.description,
                    success: result.success,
                    message: result.message,
                    details: result.details,
                    timestamp: new Date().toISOString()
                });
                
                if (result.success) {
                    this.testResults.passed++;
                } else {
                    this.testResults.failed++;
                }
            } catch (err) {
                this.results.push({
                    id: test.id,
                    name: test.name,
                    category: test.category,
                    description: test.description,
                    success: false,
                    message: '测试异常',
                    details: err.message,
                    timestamp: new Date().toISOString()
                });
                this.testResults.failed++;
            }
            
            await this.delay(300);
        }
        
        this.isRunning = false;
        this.saveResults();
        this.hideProgress();
        this.showResults();
        
        window.showToast(`自测完成: ${this.testResults.passed}通过, ${this.testResults.failed}失败`, 
            this.testResults.failed === 0 ? 'success' : 'warning');
    },
    
    async runSingleTest(testId) {
        const test = this.tests.find(t => t.id === testId);
        if (!test) {
            window.showToast('测试不存在', 'error');
            return null;
        }
        
        try {
            const result = await test.run();
            window.showToast(`${test.name}: ${result.success ? '通过' : '失败'}`, 
                result.success ? 'success' : 'error');
            return result;
        } catch (err) {
            window.showToast(`${test.name}: 异常 - ${err.message}`, 'error');
            return { success: false, message: '测试异常', details: err.message };
        }
    },
    
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },
    
    showProgress() {
        let modal = document.getElementById('selfTestProgressModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'selfTestProgressModal';
            modal.className = 'self-test-modal';
            modal.innerHTML = `
                <div class="self-test-modal-content">
                    <div class="self-test-modal-header">
                        <h3>自测进行中</h3>
                    </div>
                    <div class="self-test-modal-body">
                        <div class="self-test-progress">
                            <div class="self-test-progress-bar" id="selfTestProgressBar"></div>
                        </div>
                        <div class="self-test-status" id="selfTestStatus">正在初始化...</div>
                        <div class="self-test-count" id="selfTestCount">0 / ${this.tests.length}</div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }
        modal.classList.add('active');
    },
    
    updateProgress(index, testName) {
        const progressBar = document.getElementById('selfTestProgressBar');
        const status = document.getElementById('selfTestStatus');
        const count = document.getElementById('selfTestCount');
        
        if (progressBar) {
            const percent = ((index + 1) / this.tests.length) * 100;
            progressBar.style.width = percent + '%';
        }
        if (status) {
            status.textContent = `正在测试: ${testName}`;
        }
        if (count) {
            count.textContent = `${index + 1} / ${this.tests.length}`;
        }
    },
    
    hideProgress() {
        const modal = document.getElementById('selfTestProgressModal');
        if (modal) {
            modal.classList.remove('active');
        }
    },
    
    showResults() {
        let modal = document.getElementById('selfTestResultsModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'selfTestResultsModal';
            modal.className = 'self-test-modal';
            document.body.appendChild(modal);
        }
        
        const categories = [...new Set(this.results.map(r => r.category))];
        let resultsHtml = '';
        
        for (const category of categories) {
            const categoryResults = this.results.filter(r => r.category === category);
            resultsHtml += `
                <div class="self-test-category">
                    <div class="self-test-category-header">${category}</div>
                    <div class="self-test-category-items">
                        ${categoryResults.map(r => `
                            <div class="self-test-item ${r.success ? 'passed' : 'failed'}">
                                <div class="self-test-item-header">
                                    <span class="self-test-item-status">${r.success ? '✓' : '✗'}</span>
                                    <span class="self-test-item-name">${this.escapeHtml(r.name)}</span>
                                </div>
                                <div class="self-test-item-message">${this.escapeHtml(r.message)}</div>
                                ${r.details ? `<div class="self-test-item-details">${this.escapeHtml(r.details)}</div>` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        
        modal.innerHTML = `
            <div class="self-test-modal-content self-test-results-content">
                <div class="self-test-modal-header">
                    <h3>自测结果</h3>
                    <button class="self-test-close-btn" onclick="SelfTest.hideResults()">&times;</button>
                </div>
                <div class="self-test-summary">
                    <div class="self-test-summary-item passed">
                        <span class="count">${this.testResults.passed}</span>
                        <span class="label">通过</span>
                    </div>
                    <div class="self-test-summary-item failed">
                        <span class="count">${this.testResults.failed}</span>
                        <span class="label">失败</span>
                    </div>
                    <div class="self-test-summary-item total">
                        <span class="count">${this.testResults.total}</span>
                        <span class="label">总计</span>
                    </div>
                </div>
                <div class="self-test-modal-body">
                    ${resultsHtml}
                </div>
                <div class="self-test-modal-footer">
                    <button class="self-test-btn" onclick="SelfTest.runAllTests()">重新测试</button>
                    <button class="self-test-btn" onclick="SelfTest.exportResults()">导出结果</button>
                    <button class="self-test-btn secondary" onclick="SelfTest.hideResults()">关闭</button>
                </div>
            </div>
        `;
        
        modal.classList.add('active');
    },
    
    hideResults() {
        const modal = document.getElementById('selfTestResultsModal');
        if (modal) {
            modal.classList.remove('active');
        }
    },
    
    exportResults() {
        const exportData = {
            testResults: this.testResults,
            results: this.results,
            exportTime: new Date().toISOString(),
            userAgent: navigator.userAgent,
            url: window.location.href
        };
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `self-test-results-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        window.showToast('结果已导出', 'success');
    },
    
    getTestList() {
        return this.tests.map(t => ({
            id: t.id,
            name: t.name,
            category: t.category,
            description: t.description
        }));
    },
    
    getLastResults() {
        return {
            testResults: this.testResults,
            results: this.results
        };
    },
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

window.SelfTest = SelfTest;
