const http = require('http');
const https = require('https');

const DEFAULT_API_URL = 'http://192.168.1.12:8080/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-3.5-turbo';

module.exports = {
  id: 'llm.chat',
  name: 'AI 聊天',
  description: 'LLM API 调用服务',
  target: 'server',
  mode: 'one-shot',
  sidebar: { group: 'voiceService', tab: null, label: 'AI 聊天', icon: '💬', priority: 20 },
  params: [
    { name: 'apiUrl', type: 'string', required: false, default: 'http://192.168.1.12:8080/v1/chat/completions', label: 'API 地址' },
    { name: 'modelId', type: 'string', required: false, default: 'gpt-3.5-turbo', label: '模型' },
    { name: 'temperature', type: 'number', required: false, default: 0.7, min: 0, max: 2, step: 0.1, label: '温度' },
    { name: 'defaultModel', type: 'string', required: false, default: 'gpt-3.5-turbo', label: '默认模型' },
    { name: 'defaultTemperature', type: 'number', required: false, default: 0.7, min: 0, max: 2, step: 0.1, label: '默认温度' }
  ],
  widget: {
    html: '<div style="display:flex;flex-direction:column;gap:10px">' +
      '<div style="display:flex;gap:6px;align-items:center">' +
        '<span style="font-size:11px;color:rgba(255,255,255,0.4);white-space:nowrap">模型</span>' +
        '<input class="task-widget-field" data-field="modelId" value="gpt-3.5-turbo" style="flex:1;padding:5px 6px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;font-size:12px">' +
      '</div>' +
      '<div style="display:flex;gap:6px;align-items:center">' +
        '<span style="font-size:11px;color:rgba(255,255,255,0.4);white-space:nowrap">API</span>' +
        '<input class="task-widget-field" data-field="apiUrl" value="http://192.168.1.12:8080/v1/chat/completions" style="flex:1;padding:5px 6px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;font-size:12px">' +
      '</div>' +
      '<div style="display:flex;gap:6px;align-items:center">' +
        '<span style="font-size:11px;color:rgba(255,255,255,0.4)">温度</span>' +
        '<input type="range" class="task-widget-field" data-field="temperature" min="0" max="2" step="0.1" value="0.7" style="flex:1">' +
      '</div>' +
      '<div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:8px">' +
        '<div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:4px">消息</div>' +
        '<textarea class="task-widget-field" data-field="messages" rows="3" placeholder="输入消息..." style="width:100%;padding:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:#fff;font-size:13px;font-family:inherit;resize:vertical;box-sizing:border-box"></textarea>' +
      '</div>' +
      '<div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:8px">' +
        '<div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:4px">全局默认值</div>' +
        '<div style="display:flex;gap:6px;align-items:center">' +
          '<span style="font-size:11px;color:rgba(255,255,255,0.4);white-space:nowrap">默认模型</span>' +
          '<input class="task-widget-field" data-field="defaultModel" value="gpt-3.5-turbo" style="flex:1;padding:4px 5px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:3px;color:#aaa;font-size:11px">' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="task-card-btn task-save-global">保存全局默认</button>' +
      '</div>' +
    '</div>',
    script: [
      'var c = api.getContainer();',
      'var saveBtn = c.querySelector(".task-save-global");',
      'if (saveBtn) saveBtn.onclick = function() {',
      '  var config = {};',
      '  var els = c.querySelectorAll(".task-widget-field");',
      '  for (var i = 0; i < els.length; i++) {',
      '    var name = els[i].getAttribute("data-field");',
      '    if (!name || !name.startsWith("default")) continue;',
      '    if (els[i].type === "number") config[name] = parseFloat(els[i].value) || 0;',
      '    else config[name] = els[i].value;',
      '  }',
      '  api.sendAction("saveGlobalConfig", config);',
      '};'
    ].join('\n')
  },

  async run(context) {
    const { params, taskIO, taskName, postStream } = context;

    // 合并全局 + 实例配置
    const globalConfig = taskIO ? await taskIO.getTaskConfig(taskName) : {};

    const config = {
      apiUrl: params.apiUrl || globalConfig.apiUrl || DEFAULT_API_URL,
      modelId: params.modelId || globalConfig.defaultModel || DEFAULT_MODEL,
      temperature: params.temperature !== undefined ? params.temperature : (globalConfig.defaultTemperature || 0.7)
    };

    const messages = Array.isArray(params.messages) ? params.messages :
      (params.messages ? [{ role: 'user', content: String(params.messages) }] : []);
    if (messages.length === 0) {
      return { success: true, data: { text: '' } };
    }

    // ─── LLM API 调用（流式/非流式） ───

    function callLLM() {
      return new Promise((resolve, reject) => {
        const url = new URL(config.apiUrl);
        const isHttps = url.protocol === 'https:';
        const transport = isHttps ? https : http;

        const body = JSON.stringify({
          model: config.modelId,
          messages: messages,
          temperature: config.temperature,
          stream: !!postStream
        });

        const options = {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
          }
        };

        const req = transport.request(options, (res) => {
          if (!postStream || res.statusCode !== 200) {
            // 非流式或 API 异常：一次性收集响应
            let data = '';
            res.on('data', (chunk) => { data += chunk.toString(); });
            res.on('end', () => {
              try {
                if (res.statusCode !== 200) {
                  reject(new Error(`API 返回 ${res.statusCode}: ${data}`));
                  return;
                }
                const parsed = JSON.parse(data);
                const text = parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content;
                resolve(text || '');
              } catch (e) {
                reject(new Error('解析响应失败: ' + e.message));
              }
            });
            res.on('error', reject);
            return;
          }

          // 流式：逐 chunk 解析 SSE
          let fullText = '';
          let buffer = '';
          let index = 0;

          res.on('data', (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop(); // 剩余未完整行

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data:')) continue;
              const data = trimmed.slice(5).trim();
              if (data === '[DONE]') {
                postStream({ chunk: '', index, done: true });
                return;
              }
              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
                if (delta && delta.content) {
                  fullText += delta.content;
                  postStream({ chunk: delta.content, index: index++, done: false });
                }
              } catch (e) {
                // 跳过解析失败的行
              }
            }
          });

          res.on('end', () => {
            postStream({ chunk: '', index, done: true });
            resolve(fullText);
          });

          res.on('error', reject);
        });
        req.on('error', reject);
        req.write(body);
        req.end();
      });
    }

    try {
      const fullText = await callLLM();
      return { success: true, data: { text: fullText } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
};
