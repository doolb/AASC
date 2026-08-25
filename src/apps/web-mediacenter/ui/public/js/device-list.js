const DeviceList = {
    list: [],
    selectionMode: 'single',
    viewMode: 'tree',
    deviceEvents: {},
    expandedNodes: new Set(['server']),
    selectedNodeId: null,
    serverInfo: { ip: '', port: 8081 },

    getDisplays() {
        return this.list || [];
    },

    setSelectionMode(mode) {
        if (mode !== 'single' && mode !== 'all' && mode !== 'adaptive') {
            return;
        }
        this.selectionMode = mode;
        try {
            localStorage.setItem('deviceListSelectionMode', mode);
        } catch (e) {
            console.warn('[DeviceList] 保存选择模式失败:', e.message);
        }
        this.render();
        if (mode === 'single' && !window.currentDisplayId && this.list.length > 0) {
            const storedId = this.getStoredSelection();
            const preferred = this.list.find((display) => display.id === storedId);
            if (preferred || !storedId) {
                this.select(preferred ? preferred.id : this.list[0].id);
            }
        }
    },

    getSelectedDisplayIds(mediaRatio) {
        switch (this.selectionMode) {
            case 'single':
                return window.currentDisplayId ? [window.currentDisplayId] : [];
            case 'all':
                return this.list.map(d => d.id);
            case 'adaptive':
                return this.getAdaptiveDisplayIds(mediaRatio);
            default:
                return [];
        }
    },

    getAdaptiveDisplayIds(mediaRatio) {
        const isLandscapeMedia = mediaRatio > 1;
        const isPortraitMedia = mediaRatio < 1;
        return this.list.filter(display => {
            const isLandscapeDisplay = this.isDisplayLandscape(display);
            if (isLandscapeMedia) {
                return isLandscapeDisplay;
            } else if (isPortraitMedia) {
                return !isLandscapeDisplay;
            } else {
                return true;
            }
        }).map(d => d.id);
    },

    isDisplayLandscape(display) {
        const { width, height } = display.canvasSize || { width: 1920, height: 1080 };
        const rotation = display.rotation || 0;
        let isLandscape = width >= height;
        if (rotation === 90 || rotation === 270) {
            isLandscape = !isLandscape;
        }
        return isLandscape;
    },

    // 显示稳定身份和连接地址，避免本机 Agent 的 127.0.0.1 与真实显示端混淆。
    getDisplayLabel(display) {
        const identity = display.id || 'unknown-display';
        const address = display.ip || 'unknown-ip';
        return identity === address ? identity : `${identity} · ${address}`;
    },

    setViewMode(mode) {
        if (mode !== 'tree' && mode !== 'list') {
            return;
        }
        this.viewMode = mode;
        try { localStorage.setItem('deviceListViewMode', mode); } catch (e) {}
        this.render();
    },

    getStoredSelection() {
        try {
            return localStorage.getItem('selectedDisplayId');
        } catch (e) {
            return null;
        }
    },

    toggleViewMode() {
        this.setViewMode(this.viewMode === 'tree' ? 'list' : 'tree');
    },

    init() {
        this.loadDeviceEvents();

        try {
            const savedViewMode = localStorage.getItem('deviceListViewMode');
            if (savedViewMode === 'tree' || savedViewMode === 'list') {
                this.viewMode = savedViewMode;
            }

            const savedSelectionMode = localStorage.getItem('deviceListSelectionMode');
            if (savedSelectionMode === 'single' || savedSelectionMode === 'all' || savedSelectionMode === 'adaptive') {
                this.selectionMode = savedSelectionMode;
            }

            const savedExpandedNodes = localStorage.getItem('deviceListExpandedNodes');
            if (savedExpandedNodes) {
                const nodes = JSON.parse(savedExpandedNodes);
                if (Array.isArray(nodes)) {
                    this.expandedNodes = new Set(nodes);
                }
            }
        } catch (e) {}

        const modal = document.getElementById('featureModal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeFeatureModal();
                }
            });
        }
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
            console.error('[DeviceList] 加载设备事件配置失败:', err);
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
            console.error('[DeviceList] 保存设备事件配置失败:', err);
            if (window.showToast) {
                window.showToast('保存失败', 'error');
            }
        }
    },

    render() {
        this.renderToContainer('deviceList');
        this.renderToContainer('mediaDeviceList');
        if (window.FloatingControl) {
            window.FloatingControl.updateDisplayList();
        }
        if (this.selectionMode === 'single' && !window.currentDisplayId && this.list.length > 0) {
            const storedId = this.getStoredSelection();
            const preferred = this.list.find((display) => display.id === storedId);
            if (preferred || !storedId) {
                this.select(preferred ? preferred.id : this.list[0].id);
            }
        }
    },

    renderToContainer(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = '';

        if (this.list.length === 0) {
            container.innerHTML = '<div class="empty-list">暂无显示端连接</div>';
            return;
        }

        const headerBar = this.renderHeaderBar();
        container.appendChild(headerBar);

        const contentEl = document.createElement('div');
        contentEl.className = 'device-list-content';
        if (this.viewMode === 'tree') {
            const tree = this.buildTree();
            contentEl.appendChild(this.renderNode(tree, 0));
        } else {
            contentEl.innerHTML = this.renderListView();
        }
        container.appendChild(contentEl);
    },

    renderHeaderBar() {
        const bar = document.createElement('div');
        bar.className = 'device-list-header';

        const selectionBar = document.createElement('div');
        selectionBar.className = 'selection-mode-bar';

        const modes = [
            { key: 'single', label: '单选', icon: '1️⃣' },
            { key: 'all', label: '全选', icon: '🌐' },
            { key: 'adaptive', label: '自适应', icon: '🔀' }
        ];

        for (const mode of modes) {
            const btn = document.createElement('button');
            btn.className = `selection-mode-btn${this.selectionMode === mode.key ? ' active' : ''}`;
            btn.innerHTML = `<span class="selection-mode-icon">${mode.icon}</span>${mode.label}`;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setSelectionMode(mode.key);
            });
            selectionBar.appendChild(btn);
        }

        bar.appendChild(selectionBar);

        const viewToggle = document.createElement('button');
        viewToggle.className = 'view-toggle-btn';
        viewToggle.title = this.viewMode === 'tree' ? '切换到列表视图' : '切换到树形视图';
        viewToggle.innerHTML = this.viewMode === 'tree' ? '📋' : '🌳';
        viewToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleViewMode();
        });
        bar.appendChild(viewToggle);

        return bar;
    },

    renderListView() {
        return this.list.map(d => {
            let isActive = false;
            if (this.selectionMode === 'single') {
                isActive = d.id === window.currentDisplayId;
            } else if (this.selectionMode === 'all') {
                isActive = true;
            }

            let browserInfoHtml = '';
            if (d.browserInfo) {
                const bi = d.browserInfo;
                browserInfoHtml = `
                    <div class="browser-info">
                        <span title="${bi.userAgent}">${bi.browserName} ${bi.browserVersion}</span>
                        <span class="info-sep">|</span>
                        <span>${bi.os}</span>
                        <span class="info-sep">|</span>
                        <span>${bi.deviceType}</span>
                        <span class="info-sep">|</span>
                        <span>${bi.screenWidth}x${bi.screenHeight}</span>
                        ${bi.devicePixelRatio > 1 ? `<span class="info-sep">|</span><span>${bi.devicePixelRatio}x</span>` : ''}
                    </div>
                `;
            }

            let voiceStatusHtml = '';
            if (d.voiceSupported === true) {
                if (d.voiceListening) {
                    voiceStatusHtml = '<span class="voice-status listening" title="语音识别中">语音</span>';
                } else {
                    voiceStatusHtml = '<span class="voice-status ready" title="语音识别就绪">语音</span>';
                }
            } else if (d.voiceSupported === false) {
                voiceStatusHtml = '<span class="voice-status unsupported" title="不支持语音识别">语音</span>';
            }

            const isLandscape = this.isDisplayLandscape(d);
            const directionIndicator = `<span class="direction-indicator ${isLandscape ? 'landscape' : 'portrait'}" title="${isLandscape ? '横向' : '纵向'}">${isLandscape ? '↔' : '↕'}</span>`;

            let subDisplayIndicator = '';
            if (d.isSubDisplay) {
                subDisplayIndicator = '<span class="sub-display-indicator" title="子显示端（语音端）">🎤</span>';
            }

            let capabilityIcons = '';
            if (d.capabilities) {
                const caps = d.capabilities;
                capabilityIcons = `
                    <span class="cap-icon ${caps.mediaRendering ? 'active' : 'inactive'}" title="媒体渲染${caps.mediaRendering ? '' : '（不可用）'}">🖥️</span>
                    <span class="cap-icon ${caps.voicePlayback ? 'active' : 'inactive'}" title="语音播放${caps.voicePlayback ? '' : '（不可用）'}">🔊</span>
                    <span class="cap-icon ${caps.voiceRecording ? 'active' : 'inactive'}" title="语音录音${caps.voiceRecording ? '' : '（不可用）'}">🎙️</span>
                    <span class="cap-icon ${caps.voiceRecognition ? 'active' : 'inactive'}" title="语音识别${caps.voiceRecognition ? '' : '（不可用）'}">🧠</span>
                    <span class="cap-icon ${caps.ttsGeneration ? 'active' : 'inactive'}" title="语音生成${caps.ttsGeneration ? '' : '（不可用）'}">🗣️</span>
                    <span class="cap-icon ${caps.displayText ? 'active' : 'inactive'}" title="文本显示${caps.displayText ? '' : '（不可用）'}">📝</span>
                `;
            }

            return `
                <div class="display-item ${isActive ? 'active' : ''} ${d.isSubDisplay ? 'sub-display' : ''}" onclick="DeviceList.select('${d.id}')">
                    <div class="display-item-content">
                        <div class="display-item-header">
                            <span class="display-item-id">${this.getDisplayLabel(d)}${d.isSubDisplay ? ' <span class="sub-display-tag">子显示端</span>' : ''}</span>
                            <div class="display-item-actions">
                                ${subDisplayIndicator}
                                ${capabilityIcons}
                                ${directionIndicator}
                                ${voiceStatusHtml}
                                <span class="display-item-size">${d.canvasSize.width}x${d.canvasSize.height}</span>
                                ${d.browserInfo ? `<button class="info-btn" onclick="event.stopPropagation();DeviceList.showFeatureModal('${d.id}')">详情</button>` : ''}
                                <button class="info-btn" onclick="event.stopPropagation();DeviceList.showCapabilityEditor('${d.id}')" title="能力设置">⚙️</button>
                            </div>
                        </div>
                        ${browserInfoHtml}
                    </div>
                </div>
            `;
        }).join('');
    },

    buildTree() {
        const serverNode = {
            id: 'server',
            label: `${this.serverInfo.ip}:${this.serverInfo.port}`,
            icon: '📡',
            expanded: this.expandedNodes.has('server'),
            children: []
        };

        for (const display of this.list) {
            const eventConfig = this.deviceEvents[display.ip] || { onConnect: '', onDisconnect: '' };
            const isSubDisplay = display.isSubDisplay;
            const isSelected = window.currentDisplayId === display.id;

            const displayNode = {
                id: display.id,
                label: this.getDisplayLabel(display),
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
                this.select(node.id);
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
            const display = this.list.find(d => d.id === displayId);
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
        try { localStorage.setItem('deviceListExpandedNodes', JSON.stringify([...this.expandedNodes])); } catch (e) {}
        this.render();
    },

    select(id) {
        if (window.MediaLibrary && typeof window.MediaLibrary.clearPlaylistPanel === 'function') {
            window.MediaLibrary.clearPlaylistPanel();
        }
        this.selectedNodeId = id;
        window.currentDisplayId = id;
        try {
            localStorage.setItem('selectedDisplayId', id);
        } catch (e) {
            console.warn('[DeviceList] 保存显示端选择失败:', e.message);
        }
        this.render();

        if (window.FloatingControl) {
            window.FloatingControl.setSelectedDisplay(id);
        }

        const display = this.list.find(d => d.id === id);
        if (display) {
            window.displayCanvasSize = display.canvasSize;
            if (window.Crop) {
                window.Crop.updateContainerSize();
            }
        }

        if (window.WebSocketManager && window.WebSocketManager.ws && window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'getState',
                displayId: id
            }));
        }
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

        const display = this.list.find(d => d.id === displayId);
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
        const display = this.list.find(d => d.id === displayId);
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

    showFeatureModal(displayId) {
        const display = this.list.find(d => d.id === displayId);
        if (!display || !display.browserInfo) return;

        const bi = display.browserInfo;

        const browserDetail = document.getElementById('browserDetail');
        browserDetail.innerHTML = `
            <div class="browser-detail-row">
                <span class="browser-detail-label">浏览器</span>
                <span class="browser-detail-value">${bi.browserName} ${bi.browserVersion}</span>
            </div>
            <div class="browser-detail-row">
                <span class="browser-detail-label">操作系统</span>
                <span class="browser-detail-value">${bi.os}</span>
            </div>
            <div class="browser-detail-row">
                <span class="browser-detail-label">设备类型</span>
                <span class="browser-detail-value">${bi.deviceType}</span>
            </div>
            <div class="browser-detail-row">
                <span class="browser-detail-label">屏幕分辨率</span>
                <span class="browser-detail-value">${bi.screenWidth} x ${bi.screenHeight}</span>
            </div>
            <div class="browser-detail-row">
                <span class="browser-detail-label">设备像素比</span>
                <span class="browser-detail-value">${bi.devicePixelRatio}x</span>
            </div>
            <div class="browser-detail-row">
                <span class="browser-detail-label">IP 地址</span>
                <span class="browser-detail-value">${display.ip || 'unknown'}</span>
            </div>
        `;

        const featureList = document.getElementById('featureList');
        var features = [];
        if (bi.featureSupport && bi.featureSupport.length > 0) {
            for (var i = 0; i < bi.featureSupport.length; i++) {
                var f = bi.featureSupport[i];
                // WebGPU 改用 detectCapabilities 的真实结果
                var supported = f.supported;
                if (f.name === 'WebGPU') {
                    supported = !!(display.capabilities && display.capabilities.webgpu);
                }
                features.push({ name: f.name, note: f.note, supported: supported });
            }
        }
        // 如果 capabilities 有 webgpu 字段但 featureSupport 没有，补充一条
        if (display.capabilities && display.capabilities.webgpu !== undefined) {
            var hasWebgpuInFs = features.some(function(f) { return f.name === 'WebGPU'; });
            if (!hasWebgpuInFs) {
                features.push({ name: 'WebGPU', note: 'GPU加速计算（实时探测）', supported: !!display.capabilities.webgpu });
            }
        }
        if (features.length > 0) {
            featureList.innerHTML = features.map(function(f) { return (
                '<div class="feature-item">' +
                    '<div class="feature-name">' +
                        '<span>' + f.name + '</span>' +
                        '<span>' + f.note + '</span>' +
                    '</div>' +
                    '<span class="feature-badge ' + (f.supported ? 'supported' : 'unsupported') + '">' +
                        (f.supported ? '支持' : '不支持') +
                    '</span>' +
                '</div>'
            ); }).join('');
        } else {
            featureList.innerHTML = '<div style="text-align:center;color:#666;padding:20px;">暂无功能支持信息</div>';
        }

        document.getElementById('featureModal').classList.add('active');
    },

    closeFeatureModal() {
        document.getElementById('featureModal').classList.remove('active');
    },

    showCapabilityEditor(displayId) {
        const display = this.list.find(d => d.id === displayId);
        if (!display) return;

        const caps = display.capabilities || {
            mediaRendering: true,
            voicePlayback: true,
            voiceRecording: true,
            voiceRecognition: false,
            ttsGeneration: false,
            displayText: true
        };

        const existing = document.getElementById('capabilityModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'capabilityModal';
        modal.className = 'capability-modal';
        modal.innerHTML = `
            <div class="capability-editor">
                <h3>显示端 ${display.ip || 'unknown'} 能力设置</h3>
                <div class="capability-list">
                    <label class="capability-item">
                        <input type="checkbox" ${caps.mediaRendering ? 'checked' : ''} data-cap="mediaRendering">
                        <span>🖥️ 媒体渲染</span>
                        <span class="capability-desc">能显示图片/视频</span>
                    </label>
                    <label class="capability-item">
                        <input type="checkbox" ${caps.voicePlayback ? 'checked' : ''} data-cap="voicePlayback">
                        <span>🔊 语音播放</span>
                        <span class="capability-desc">语音播放为手动路由开关，开启后可作为文本TTS播报设备</span>
                    </label>
                    <label class="capability-item">
                        <input type="checkbox" ${caps.voiceRecording ? 'checked' : ''} data-cap="voiceRecording">
                        <span>🎙️ 语音录音</span>
                        <span class="capability-desc">能录制音频</span>
                    </label>
                    <label class="capability-item">
                        <input type="checkbox" ${caps.voiceRecognition ? 'checked' : ''} data-cap="voiceRecognition">
                        <span>🧠 语音识别</span>
                        <span class="capability-desc">能进行语音识别</span>
                    </label>
                    <label class="capability-item">
                        <input type="checkbox" ${caps.ttsGeneration ? 'checked' : ''} data-cap="ttsGeneration">
                        <span>🗣️ 语音生成</span>
                        <span class="capability-desc">能在显示端离线合成语音</span>
                    </label>
                    <label class="capability-item">
                        <input type="checkbox" ${caps.displayText ? 'checked' : ''} data-cap="displayText">
                        <span>📝 文本显示</span>
                        <span class="capability-desc">能显示文字覆盖层</span>
                    </label>
                </div>
                <div class="capability-actions">
                    <button class="capability-save-btn" onclick="DeviceList.saveCapabilities('${displayId}')">保存</button>
                    <button class="capability-cancel-btn" onclick="DeviceList.closeCapabilityEditor()">取消</button>
                </div>
            </div>
        `;

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeCapabilityEditor();
            }
        });

        document.body.appendChild(modal);
    },

    saveCapabilities(displayId) {
        const checkboxes = document.querySelectorAll('#capabilityModal input[type="checkbox"]');
        const capabilities = {};
        checkboxes.forEach(cb => {
            capabilities[cb.dataset.cap] = cb.checked;
        });

        if (window.WebSocketManager && window.WebSocketManager.ws && window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'updateCapabilities',
                displayId: displayId,
                capabilities: capabilities
            }));
        }

        this.closeCapabilityEditor();
    },

    closeCapabilityEditor() {
        const modal = document.getElementById('capabilityModal');
        if (modal) modal.remove();
    },

    setDisplayList(list) {
        this.list = list || [];
        const selectedStillOnline = this.list.some((display) => display.id === window.currentDisplayId);
        if (!selectedStillOnline) {
            window.currentDisplayId = null;
            this.selectedNodeId = null;
        }
        this.render();
    }
};

window.selectDisplay = DeviceList.select.bind(DeviceList);
window.showFeatureModal = DeviceList.showFeatureModal.bind(DeviceList);
window.closeFeatureModal = DeviceList.closeFeatureModal.bind(DeviceList);
window.DisplayList = DeviceList;
window.DeviceList = DeviceList;
window.DeviceTree = DeviceList;
