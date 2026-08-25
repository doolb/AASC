const DeviceTree = {
    displayList: [],
    deviceEvents: {},
    expandedNodes: new Set(['server']),
    selectedNodeId: null,
    serverInfo: { ip: '', port: 8081 },

    init() {
        this.loadDeviceEvents();
    },

    setServerInfo(ip, port) {
        this.serverInfo = { ip, port };
    },

    async loadDeviceEvents() {
        try {
            const res = await fetch('/api/device-events');
            const data = await res.json();
            if (data.status === 'success') {
                this.deviceEvents = data.events || {};
            }
        } catch (err) {
            console.error('[DeviceTree] 加载设备事件配置失败:', err);
        }
    },

    async saveDeviceEvent(ip, onConnect, onDisconnect) {
        try {
            const res = await fetch(`/api/device-events/${encodeURIComponent(ip)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ onConnect, onDisconnect })
            });
            const data = await res.json();
            if (data.status === 'success') {
                this.deviceEvents[ip] = data.event;
                if (window.showToast) {
                    window.showToast('事件指令已保存', 'success');
                }
            }
        } catch (err) {
            console.error('[DeviceTree] 保存设备事件配置失败:', err);
            if (window.showToast) {
                window.showToast('保存失败', 'error');
            }
        }
    },

    buildTree() {
        const serverNode = {
            id: 'server',
            label: `${this.serverInfo.ip}:${this.serverInfo.port}`,
            icon: '📡',
            expanded: this.expandedNodes.has('server'),
            children: []
        };

        for (const display of this.displayList) {
            const eventConfig = this.deviceEvents[display.ip] || { onConnect: '', onDisconnect: '' };
            const isSubDisplay = display.isSubDisplay;
            const isSelected = window.currentDisplayId === display.id;

            const displayNode = {
                id: display.id,
                label: display.ip || 'unknown',
                icon: isSubDisplay ? '🎤' : '🖥️',
                status: 'online',
                selected: isSelected,
                expanded: this.expandedNodes.has(display.id),
                displayData: display,
                children: [
                    {
                        id: `${display.id}-settings`,
                        label: '画面设置',
                        icon: '⚙️',
                        type: 'settings',
                        expanded: this.expandedNodes.has(`${display.id}-settings`),
                        displayData: display,
                        children: this.buildSettingsChildren(display)
                    },
                    {
                        id: `${display.id}-events`,
                        label: '事件指令',
                        icon: '🔔',
                        type: 'events',
                        expanded: this.expandedNodes.has(`${display.id}-events`),
                        displayData: display,
                        eventConfig: eventConfig,
                        children: this.buildEventsChildren(display, eventConfig)
                    },
                    {
                        id: `${display.id}-info`,
                        label: '浏览器信息',
                        icon: 'ℹ️',
                        type: 'info',
                        expanded: this.expandedNodes.has(`${display.id}-info`),
                        displayData: display,
                        children: this.buildInfoChildren(display)
                    },
                    {
                        id: `${display.id}-capabilities`,
                        label: '设备能力',
                        icon: '⚡',
                        type: 'capabilities',
                        expanded: this.expandedNodes.has(`${display.id}-capabilities`),
                        displayData: display,
                        children: this.buildCapabilitiesChildren(display)
                    }
                ]
            };

            serverNode.children.push(displayNode);
        }

        return serverNode;
    },

    buildSettingsChildren(display) {
        const children = [];

        children.push({
            id: `${display.id}-rotation`,
            label: '旋转',
            type: 'setting-item',
            settingKey: 'rotation',
            value: display.rotation || 0,
            editable: true,
            inputType: 'select',
            options: [
                { value: 0, label: '0°' },
                { value: 90, label: '90°' },
                { value: 180, label: '180°' },
                { value: 270, label: '270°' }
            ]
        });

        children.push({
            id: `${display.id}-fit`,
            label: '填充',
            type: 'setting-item',
            settingKey: 'fit',
            value: display.fit || 'contain',
            editable: true,
            inputType: 'select',
            options: [
                { value: 'contain', label: '适应' },
                { value: 'cover', label: '铺满' },
                { value: 'dynamic', label: '动态' },
                { value: 'height', label: '高度铺满' },
                { value: 'width', label: '宽度铺满' },
                { value: 'crop', label: '裁剪' }
            ]
        });

        children.push({
            id: `${display.id}-volume`,
            label: '音量',
            type: 'setting-item',
            settingKey: 'volume',
            value: display.volume !== undefined ? display.volume : 100,
            editable: true,
            inputType: 'range',
            min: 0,
            max: 100
        });

        children.push({
            id: `${display.id}-canvasSize`,
            label: '画布',
            type: 'setting-item',
            settingKey: 'canvasSize',
            value: `${display.canvasSize?.width || 1920}x${display.canvasSize?.height || 1080}`,
            editable: false
        });

        return children;
    },

    buildEventsChildren(display, eventConfig) {
        return [
            {
                id: `${display.id}-onConnect`,
                label: '连线指令',
                type: 'event-item',
                eventKey: 'onConnect',
                value: eventConfig.onConnect || '',
                editable: true,
                inputType: 'text',
                placeholder: '设备连接时执行的指令'
            },
            {
                id: `${display.id}-onDisconnect`,
                label: '掉线指令',
                type: 'event-item',
                eventKey: 'onDisconnect',
                value: eventConfig.onDisconnect || '',
                editable: true,
                inputType: 'text',
                placeholder: '设备断开时执行的指令'
            }
        ];
    },

    buildInfoChildren(display) {
        const children = [];
        const bi = display.browserInfo;

        if (bi) {
            children.push({
                id: `${display.id}-browser`,
                label: `${bi.browserName || ''} ${bi.browserVersion || ''} | ${bi.os || ''}`,
                type: 'info-item'
            });
            children.push({
                id: `${display.id}-screen`,
                label: `${bi.screenWidth || '?'}x${bi.screenHeight || '?'}${bi.devicePixelRatio > 1 ? ` @ ${bi.devicePixelRatio}x` : ''}`,
                type: 'info-item'
            });
        } else {
            children.push({
                id: `${display.id}-noInfo`,
                label: '暂无信息',
                type: 'info-item'
            });
        }

        return children;
    },

    buildCapabilitiesChildren(display) {
        const children = [];
        const caps = display.capabilities || {
            mediaRendering: true,
            voicePlayback: true,
            voiceRecording: true,
            voiceRecognition: false,
            ttsGeneration: false,
            displayText: true
        };

        const capabilityDefinitions = [
            { key: 'mediaRendering', label: '媒体渲染', icon: '🖥️' },
            { key: 'voicePlayback', label: '语音播放', icon: '🔊' },
            { key: 'voiceRecording', label: '语音录音', icon: '🎙️' },
            { key: 'voiceRecognition', label: '语音识别', icon: '🧠' },
            { key: 'ttsGeneration', label: '语音生成', icon: '🗣️' },
            { key: 'displayText', label: '文本显示', icon: '📝' }
        ];

        for (const capDef of capabilityDefinitions) {
            children.push({
                id: `${display.id}-cap-${capDef.key}`,
                label: capDef.label,
                icon: capDef.icon,
                type: 'capability-item',
                capabilityKey: capDef.key,
                value: caps[capDef.key] !== undefined ? caps[capDef.key] : true,
                editable: true,
                inputType: 'select',
                options: [
                    { value: true, label: '启用' },
                    { value: false, label: '禁用' }
                ]
            });
        }

        return children;
    },

    render() {
        this.renderToContainer('deviceTree');
        this.renderToContainer('mediaDeviceTree');
    },

    renderToContainer(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = '';

        if (this.displayList.length === 0) {
            container.innerHTML = '<div class="empty-list">暂无显示端连接</div>';
            return;
        }

        const selectionBar = this.renderSelectionBar();
        if (selectionBar) {
            container.appendChild(selectionBar);
        }

        const tree = this.buildTree();
        container.appendChild(this.renderNode(tree, 0));
    },

    renderSelectionBar() {
        if (!window.DisplayList) return null;

        const dl = window.DisplayList;
        const bar = document.createElement('div');
        bar.className = 'tree-selection-bar';

        const modes = [
            { key: 'single', label: '单选', icon: '1️⃣' },
            { key: 'all', label: '全选', icon: '🌐' },
            { key: 'adaptive', label: '自适应', icon: '🔀' }
        ];

        for (const mode of modes) {
            const btn = document.createElement('button');
            btn.className = `tree-selection-btn${dl.selectionMode === mode.key ? ' active' : ''}`;
            btn.innerHTML = `<span class="tree-selection-icon">${mode.icon}</span>${mode.label}`;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                dl.selectionMode = mode.key;
                if (mode.key === 'all') {
                    dl.selectAll();
                } else if (mode.key === 'single' && dl.selectedDisplays.size === 0 && dl.list.length > 0) {
                    dl.select(dl.list[0].id);
                }
                this.render();
            });
            bar.appendChild(btn);
        }

        return bar;
    },

    renderNode(node, depth) {
        const wrapper = document.createElement('div');
        wrapper.className = 'tree-node-wrapper';

        const nodeEl = document.createElement('div');
        nodeEl.className = 'tree-node';
        if (node.selected || node.id === this.selectedNodeId) {
            nodeEl.classList.add('selected');
        }
        nodeEl.style.paddingLeft = `${depth * 16 + 8}px`;

        const hasChildren = node.children && node.children.length > 0;

        if (hasChildren) {
            const toggle = document.createElement('span');
            toggle.className = 'tree-toggle';
            toggle.textContent = node.expanded ? '▼' : '▶';
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleNode(node.id);
            });
            nodeEl.appendChild(toggle);
        } else {
            const spacer = document.createElement('span');
            spacer.className = 'tree-toggle-spacer';
            nodeEl.appendChild(spacer);
        }

        if (node.icon) {
            const icon = document.createElement('span');
            icon.className = 'tree-icon';
            icon.textContent = node.icon;
            nodeEl.appendChild(icon);
        }

        const label = document.createElement('span');
        label.className = 'tree-label';
        label.textContent = node.label;
        nodeEl.appendChild(label);

        if (node.type === 'setting-item') {
            const valueEl = this.renderSettingControl(node);
            if (valueEl) {
                nodeEl.appendChild(valueEl);
            }
        }

        if (node.type === 'event-item') {
            const eventEl = this.renderEventControl(node);
            if (eventEl) {
                nodeEl.appendChild(eventEl);
            }
        }

        if (node.type === 'capability-item') {
            const capEl = this.renderCapabilityControl(node);
            if (capEl) {
                nodeEl.appendChild(capEl);
            }
        }

        if (node.status === 'online') {
            const status = document.createElement('span');
            status.className = 'tree-status online';
            status.title = '在线';
            nodeEl.appendChild(status);
        }

        if (node.type === 'info-item') {
            nodeEl.classList.add('tree-info-item');
        }

        if (node.displayData && node.type === undefined) {
            nodeEl.addEventListener('click', () => {
                this.selectDisplay(node.id);
            });
        }

        wrapper.appendChild(nodeEl);

        if (hasChildren && node.expanded) {
            const childrenEl = document.createElement('div');
            childrenEl.className = 'tree-children';
            for (const child of node.children) {
                childrenEl.appendChild(this.renderNode(child, depth + 1));
            }
            wrapper.appendChild(childrenEl);
        }

        return wrapper;
    },

    renderSettingControl(node) {
        const container = document.createElement('div');
        container.className = 'tree-setting-control';

        if (node.inputType === 'select') {
            const select = document.createElement('select');
            select.className = 'tree-setting-select';
            for (const opt of node.options) {
                const option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.label;
                if (String(opt.value) === String(node.value)) {
                    option.selected = true;
                }
                select.appendChild(option);
            }
            select.addEventListener('change', (e) => {
                e.stopPropagation();
                const value = isNaN(e.target.value) ? e.target.value : Number(e.target.value);
                this.updateSetting(node.id.split('-').slice(0, -1).join('-'), node.settingKey, value);
            });
            select.addEventListener('click', (e) => e.stopPropagation());
            container.appendChild(select);
        } else if (node.inputType === 'range') {
            const rangeWrap = document.createElement('div');
            rangeWrap.className = 'tree-setting-range-wrap';

            const range = document.createElement('input');
            range.type = 'range';
            range.className = 'tree-setting-range';
            range.min = node.min || 0;
            range.max = node.max || 100;
            range.value = node.value;

            const valueLabel = document.createElement('span');
            valueLabel.className = 'tree-setting-range-value';
            valueLabel.textContent = `${node.value}%`;

            range.addEventListener('input', (e) => {
                e.stopPropagation();
                valueLabel.textContent = `${e.target.value}%`;
            });
            range.addEventListener('change', (e) => {
                e.stopPropagation();
                this.updateSetting(node.id.split('-').slice(0, -1).join('-'), node.settingKey, Number(e.target.value));
            });
            range.addEventListener('click', (e) => e.stopPropagation());

            rangeWrap.appendChild(range);
            rangeWrap.appendChild(valueLabel);
            container.appendChild(rangeWrap);
        }

        return container;
    },

    renderEventControl(node) {
        const container = document.createElement('div');
        container.className = 'tree-event-control';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tree-event-input';
        input.value = node.value;
        input.placeholder = node.placeholder || '';
        input.addEventListener('click', (e) => e.stopPropagation());
        input.addEventListener('change', (e) => {
            e.stopPropagation();
        });

        const saveBtn = document.createElement('button');
        saveBtn.className = 'tree-event-save';
        saveBtn.textContent = '保存';
        saveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const displayId = node.id.replace(`-${node.eventKey}`, '');
            const display = this.displayList.find(d => d.id === displayId);
            if (!display) return;

            const ip = display.ip;
            const currentEvents = this.deviceEvents[ip] || { onConnect: '', onDisconnect: '' };
            currentEvents[node.eventKey] = input.value;
            this.saveDeviceEvent(ip, currentEvents.onConnect, currentEvents.onDisconnect);
        });

        container.appendChild(input);
        container.appendChild(saveBtn);

        return container;
    },

    renderCapabilityControl(node) {
        const container = document.createElement('div');
        container.className = 'tree-capability-control';

        const select = document.createElement('select');
        select.className = 'tree-capability-select';
        for (const opt of node.options) {
            const option = document.createElement('option');
            option.value = String(opt.value);
            option.textContent = opt.label;
            if (String(opt.value) === String(node.value)) {
                option.selected = true;
            }
            select.appendChild(option);
        }
        select.addEventListener('change', (e) => {
            e.stopPropagation();
            const value = e.target.value === 'true';
            this.updateCapability(node.id, node.capabilityKey, value);
        });
        select.addEventListener('click', (e) => e.stopPropagation());
        container.appendChild(select);

        return container;
    },

    toggleNode(nodeId) {
        if (this.expandedNodes.has(nodeId)) {
            this.expandedNodes.delete(nodeId);
        } else {
            this.expandedNodes.add(nodeId);
        }
        this.render();
    },

    selectDisplay(displayId) {
        this.selectedNodeId = displayId;
        window.currentDisplayId = displayId;

        if (window.DisplayList) {
            window.DisplayList.select(displayId);
        }

        this.render();
    },

    updateSetting(displayId, key, value) {
        if (window.WebSocketManager && window.WebSocketManager.ws && window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'control',
                displayId: displayId,
                action: key,
                value: value
            }));
        }

        const display = this.displayList.find(d => d.id === displayId);
        if (display) {
            if (key === 'rotation') display.rotation = value;
            else if (key === 'fit') display.fit = value;
            else if (key === 'volume') display.volume = value;
        }

        if (window.showToast) {
            window.showToast(`${key} 已更新`, 'success');
        }
    },

    updateCapability(nodeId, key, value) {
        const displayId = nodeId.replace(`-cap-${key}`, '');
        const display = this.displayList.find(d => d.id === displayId);
        if (!display) return;

        const capabilities = display.capabilities || {
            mediaRendering: true,
            voicePlayback: true,
            voiceRecording: true,
            voiceRecognition: false,
            ttsGeneration: false,
            displayText: true
        };

        capabilities[key] = value;

        if (window.WebSocketManager && window.WebSocketManager.ws && window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'updateCapabilities',
                displayId: displayId,
                capabilities: capabilities
            }));
        }

        display.capabilities = capabilities;

        if (window.showToast) {
            const labelMap = {
                mediaRendering: '媒体渲染',
                voicePlayback: '语音播放',
                voiceRecording: '语音录音',
                voiceRecognition: '语音识别',
                ttsGeneration: '语音生成',
                displayText: '文本显示'
            };
            window.showToast(`${labelMap[key] || key} 已${value ? '启用' : '禁用'}`, 'success');
        }
    },

    setDisplayList(list) {
        this.displayList = list || [];
        this.render();
    }
};

window.DeviceTree = DeviceTree;
