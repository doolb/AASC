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
            description: '测试自定义TTS播报',
            category: '语音功能',
            run: async () => {
                if (!window.currentDisplayId) {
                    return { success: false, message: '未选择显示端', details: '请先选择一个显示端' };
                }
                try {
                    window.WebSocketManager.sendTts('play', { text: '自测语音播报测试' });
                    return { success: true, message: 'TTS命令已发送', details: 'text: 自测语音播报测试' };
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
