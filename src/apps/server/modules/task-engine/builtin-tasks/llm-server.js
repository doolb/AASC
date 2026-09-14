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
    // 保留旧字段供旧版本控制端兼容；新版本统一通过 control.actions 渲染任务自带页面。
    configButton: { id: 'defaultModelMappings', label: '默认映射' },
    control: {
        actions: [{
            id: 'defaultModelMappings',
            label: '默认映射',
            placement: 'task',
            title: '本地 LLM 网关 · 默认映射',
            html: '<div data-role="llm-default-mappings">' +
                '<div class="task-confirm-msg" style="margin-bottom:12px">将外部请求中的模型名映射到已发布的本地模型 ID。模型清单变化后可重新打开面板更新。</div>' +
                '<div data-role="error" style="display:none;color:#ff9b9b;font-size:12px;margin-bottom:8px"></div>' +
                '<div data-role="rows" style="max-height:420px;overflow-y:auto"></div>' +
                '<button class="task-card-btn" data-action="add" type="button" style="margin-top:10px">+ 添加映射</button>' +
                '<div class="task-confirm-actions" style="margin-top:16px">' +
                    '<button class="task-confirm-btn cancel" data-action="cancel" type="button">取消</button>' +
                    '<button class="task-confirm-btn confirm" data-action="save" type="button" style="background:rgba(0,210,255,0.15);color:#8cf">保存</button>' +
                '</div>' +
            '</div>',
            script: `
const container = api.getContainer();
const rowsElement = container.querySelector('[data-role="rows"]');
const errorElement = container.querySelector('[data-role="error"]');
const saveButton = container.querySelector('[data-action="save"]');
let mappings = [];
let dirty = false;
let saving = false;
let requestId = null;

const getModels = function() {
    const manifest = window.DeviceList && window.DeviceList.llmModelManifest;
    return manifest && Array.isArray(manifest.models)
        ? manifest.models.filter(function(model) { return model && model.modelId; })
        : [];
};

const modelOptions = function(selectedModelId) {
    const models = getModels();
    let html = '<option value="">请选择内部模型</option>';
    for (const model of models) {
        const modelId = String(model.modelId);
        const displayName = model.displayName ? String(model.displayName) : modelId;
        const readyText = model.ready === false ? '（未准备好）' : '';
        html += '<option value="' + api.escapeAttr(modelId) + '"' +
            (modelId === selectedModelId ? ' selected' : '') + '>' +
            api.escapeHtml(displayName + ' · ' + modelId + readyText) + '</option>';
    }
    if (models.length === 0 && selectedModelId) {
        html += '<option value="' + api.escapeAttr(selectedModelId) + '" selected>' +
            api.escapeHtml(selectedModelId + '（当前映射，模型清单未加载）') + '</option>';
    }
    return html;
};

const collectMappings = function() {
    return Array.from(rowsElement.querySelectorAll('.llm-default-mapping-row')).map(function(row) {
        const external = row.querySelector('.llm-default-mapping-external');
        const model = row.querySelector('.llm-default-mapping-model');
        return {
            externalModelName: external ? external.value : '',
            modelId: model ? model.value : ''
        };
    });
};

const renderRows = function() {
    const rows = mappings.length > 0 ? mappings : [{ externalModelName: '', modelId: '' }];
    rowsElement.innerHTML = rows.map(function(mapping, index) {
        return '<div class="llm-default-mapping-row" data-index="' + index + '" style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:8px;align-items:center;margin-bottom:8px">' +
            '<input class="llm-default-mapping-external" type="text" value="' + api.escapeAttr(mapping.externalModelName) + '" placeholder="外部模型名" style="width:100%;padding:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;box-sizing:border-box">' +
            '<select class="llm-default-mapping-model" style="width:100%;padding:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;box-sizing:border-box">' +
                modelOptions(mapping.modelId) +
            '</select>' +
            '<button class="task-confirm-btn cancel llm-default-mapping-remove" data-action="remove" type="button" style="padding:8px 10px">删除</button>' +
        '</div>';
    }).join('');
};

const setError = function(message) {
    errorElement.textContent = message || '';
    errorElement.style.display = message ? 'block' : 'none';
};

api.onMessage('llm.defaultModelMappings', function(data) {
    const next = Array.isArray(data.mappings) ? data.mappings.map(function(mapping) {
        return {
            externalModelName: typeof mapping.externalModelName === 'string' ? mapping.externalModelName : '',
            modelId: typeof mapping.modelId === 'string' ? mapping.modelId : ''
        };
    }) : [];
    mappings = next;
    if (saving && requestId && data.requestId === requestId) {
        api.close();
        return;
    }
    if (dirty) {
        setError('服务端配置已更新，当前编辑草稿未覆盖；点击保存可提交当前草稿。');
        return;
    }
    renderRows();
});

api.onMessage('llm.defaultModelMappingsError', function(data) {
    saving = false;
    saveButton.disabled = false;
    setError(data.message || '默认模型映射保存失败');
});

container.addEventListener('input', function() { dirty = true; });
container.addEventListener('change', function() { dirty = true; });
container.addEventListener('click', function(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'add') {
        dirty = true;
        mappings = collectMappings();
        mappings.push({ externalModelName: '', modelId: '' });
        renderRows();
        return;
    }
    if (action === 'remove') {
        dirty = true;
        mappings = collectMappings();
        const row = button.closest('.llm-default-mapping-row');
        const index = row ? Number(row.dataset.index) : -1;
        if (index >= 0) mappings.splice(index, 1);
        renderRows();
        return;
    }
    if (action === 'cancel') {
        api.close();
        return;
    }
    if (action !== 'save' || saving) return;
    saving = true;
    dirty = true;
    requestId = 'llm-default-mapping-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    saveButton.disabled = true;
    setError('');
    const sent = api.sendMessage({
        type: 'llm.defaultModelMappings.set',
        requestId,
        mappings: collectMappings()
    });
    if (!sent) {
        saving = false;
        saveButton.disabled = false;
        setError('WebSocket 未连接，配置尚未保存；连接恢复后可重试。');
    }
});

renderRows();
api.sendMessage({ type: 'llm.defaultModelMappings.get' });
`
        }]
    },
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
        const httpHandlers = context.llmHttpHandlers;
        if (!httpHandlers || typeof httpHandlers.models !== 'function' ||
            typeof httpHandlers.request !== 'function' || typeof context.registerRoute !== 'function') {
            throw new Error('本地 LLM 网关任务缺少 HTTP 路由能力');
        }
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
        const routeDefinitions = [
            {
                method: 'GET',
                path: '/v1/models',
                handler: ({ request, response }) => httpHandlers.models(request, response)
            },
            {
                method: 'POST',
                path: '/v1/chat/completions',
                handler: ({ request, response }) => httpHandlers.request(request, response, 'chat.completions')
            },
            {
                method: 'POST',
                path: '/v1/responses',
                handler: ({ request, response }) => httpHandlers.request(request, response, 'responses')
            },
            {
                method: 'POST',
                path: '/v1/chat/responses',
                handler: ({ request, response }) => httpHandlers.request(request, response, 'responses')
            }
        ];
        const unregisterRoutes = [];
        try {
            for (const route of routeDefinitions) {
                unregisterRoutes.push(await context.registerRoute(route));
            }
        } catch (error) {
            for (const unregister of unregisterRoutes.reverse()) {
                if (typeof unregister === 'function') unregister();
            }
            throw error;
        }
        pushWidgetUpdate();
        return {
            type: 'service',
            stop: async () => {
                for (const unregister of unregisterRoutes.reverse()) {
                    if (typeof unregister === 'function') unregister();
                }
                pushWidgetUpdate();
            }
        };
    }
};
