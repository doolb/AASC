'use strict';

function buildWidgetData(gateway) {
    const status = typeof gateway?.getStatus === 'function'
        ? gateway.getStatus()
        : { status: 'running', modelCount: 0, displayCount: 0 };
    return {
        statusText: status.status === 'running' ? '运行中' : '不可用',
        _statusColor: status.status === 'running' ? '#4ade80' : '#f87171',
        endpointText: '/v1/chat/completions · /v1/responses',
        modelText: String(status.modelCount),
        displayText: String(status.displayCount)
    };
}

module.exports = {
    id: 'llm-server',
    name: '本地 LLM 网关',
    description: '管理 Android MNNChat 本地 LLM 网关和显示端路由',
    target: 'server',
    mode: 'service',
    sidebar: { group: 'voiceService', tab: null, label: '本地 LLM', icon: '🧠', priority: 30 },
    params: [],
    widget: {
        html: '<div style="display:flex;flex-direction:column;gap:8px">' +
            '<div>状态：<strong style="color:{{_statusColor}}">{{statusText}}</strong></div>' +
            '<div>模型：{{modelText}}　显示端：{{displayText}}</div>' +
            '<div style="font-size:12px">接口：{{endpointText}}</div>' +
            '<div><button class="task-card-btn" onclick="TaskPanel._onWidgetAction(\'{{instanceId}}\',\'widgetRefresh\')">刷新</button>' +
            '<button class="task-card-btn danger" onclick="TaskPanel._stopInstance(\'{{instanceId}}\')">停止服务</button></div>' +
        '</div>',
        actions: [{ id: 'widgetRefresh', label: '刷新' }]
    },
    async run(context) {
        const gateway = context.llmGatewayService;
        if (!gateway) throw new Error('本地 LLM 网关未初始化');
        const pushWidgetUpdate = () => {
            if (typeof context.postWidgetUpdate === 'function') {
                context.postWidgetUpdate(buildWidgetData(gateway));
            }
        };
        if (typeof context.onWidgetAction === 'function') {
            context.onWidgetAction('widgetRefresh', async () => {
                pushWidgetUpdate();
                return { success: true, data: gateway.getStatus() };
            });
        }
        pushWidgetUpdate();
        return {
            type: 'service',
            stop: async () => pushWidgetUpdate()
        };
    }
};
