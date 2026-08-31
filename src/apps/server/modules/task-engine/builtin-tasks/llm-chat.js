const http = require('http');
const https = require('https');
const { createResponsesClient } = require('../../../../../external/llm/llm-responses-client');

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
    { name: 'messages', type: 'string', required: false, default: '', label: '消息' },
    { name: 'systemPrompt', type: 'string', required: false, default: '你是一个友好的助手，请用简洁的语言回答问题。', label: '系统提示词' },
    { name: 'promptFormat', type: 'string', required: false, default: 'openai', label: '消息格式' },
    { name: 'contextCount', type: 'number', required: false, default: 10, min: 0, max: 200, label: '上下文条数' },
    { name: 'maxTokens', type: 'number', required: false, default: 4096, min: 1, max: 131072, label: '最大 Tokens' },
    { name: 'apiKey', type: 'string', required: false, default: '', label: 'API Key' }
  ],
  widget: {
    html: '<div style="display:flex;flex-direction:column;gap:10px">' +
      '<div style="display:flex;gap:6px;align-items:center">' +
        '<span style="font-size:11px;color:rgba(255,255,255,0.4);white-space:nowrap">模型</span>' +
        '<input class="task-widget-field" data-field="modelId" value="{{modelId}}" style="flex:1;padding:5px 6px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;font-size:12px">' +
      '</div>' +
      '<div style="display:flex;gap:6px;align-items:center">' +
        '<span style="font-size:11px;color:rgba(255,255,255,0.4);white-space:nowrap">API</span>' +
        '<input class="task-widget-field" data-field="apiUrl" value="{{apiUrl}}" style="flex:1;padding:5px 6px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;font-size:12px">' +
      '</div>' +
      '<div style="display:flex;gap:6px;align-items:center">' +
        '<span style="font-size:11px;color:rgba(255,255,255,0.4)">温度</span>' +
        '<input type="range" class="task-widget-field" data-field="temperature" min="0" max="2" step="0.1" value="{{temperature}}" style="flex:1">' +
      '</div>' +
      '<div style="display:flex;gap:6px;align-items:center">' +
        '<span style="font-size:11px;color:rgba(255,255,255,0.4);white-space:nowrap;min-width:36px">格式</span>' +
        '<select class="task-widget-field" data-field="promptFormat" style="width:90px;padding:5px 6px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;font-size:12px">' +
          '<option value="openai" {{_selOpenai}}>OpenAI</option>' +
          '<option value="raw" {{_selRaw}}>纯文本</option>' +
        '</select>' +
      '</div>' +
      '<div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:8px">' +
        '<div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:4px">消息</div>' +
        '<textarea class="task-widget-field" data-field="messages" rows="3" placeholder="输入消息..." style="width:100%;padding:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:#fff;font-size:13px;font-family:inherit;resize:vertical;box-sizing:border-box">{{messages}}</textarea>' +
      '</div>' +
    '</div>'
  },

  async run(context) {
    const { params, taskIO, taskName, postStream, chatService } = context;

    // 合并全局 + 实例配置 (全局配置通过 task:set_config 持久化到 config.json)
    const globalConfig = taskIO ? await taskIO.getTaskConfig(taskName) : {};
    const globalChatConfig = chatService?.getConfig?.() || null;
    const useResponses = Boolean(globalChatConfig && globalChatConfig.protocol !== 'openai-completions');

    const config = {
      apiUrl: params.apiUrl || globalConfig.apiUrl || globalChatConfig?.apiUrl || DEFAULT_API_URL,
      modelId: params.modelId || globalConfig.modelId || globalChatConfig?.model || DEFAULT_MODEL,
      temperature: params.temperature ?? globalConfig.temperature ?? 0.7,
      systemPrompt: params.systemPrompt || globalConfig.systemPrompt || '',
      promptFormat: params.promptFormat || globalConfig.promptFormat || 'openai',
      maxTokens: params.maxTokens || globalConfig.maxTokens || 4096,
      apiKey: params.apiKey || globalConfig.apiKey || globalChatConfig?.apiKey || '',
      responsesBaseUrl: globalChatConfig?.responsesBaseUrl || 'http://127.0.0.1:8083/v1',
      responsesApiKey: globalChatConfig?.responsesApiKey || ''
    };

    let messages = [];
    if (config.promptFormat === 'raw') {
      let text = '';
      if (config.systemPrompt) text += 'System: ' + config.systemPrompt + '\n';
      if (params.messages) {
        const userMsgs = Array.isArray(params.messages) ? params.messages :
          [String(params.messages)];
        for (const m of userMsgs) {
          const content = typeof m === 'string' ? m : (m.content || '');
          if (content) text += 'User: ' + content + '\n';
        }
      }
      text += 'AI: ';
      messages = [{ role: 'user', content: text }];
    } else if (config.systemPrompt) {
      messages.push({ role: 'system', content: config.systemPrompt });
    }
    if (params.messages && config.promptFormat !== 'raw') {
      const userMessages = Array.isArray(params.messages) ? params.messages :
        [{ role: 'user', content: String(params.messages) }];
      messages.push(...userMessages);
    }
    if (messages.length === 0) {
      return { success: true, data: { text: '' } };
    }

    // ─── LLM API 调用（流式/非流式） ───

    async function callResponses() {
      const client = createResponsesClient({ baseUrl: config.responsesBaseUrl, apiKey: config.responsesApiKey });
      const request = {
        model: config.modelId,
        input: messages,
        temperature: config.temperature,
        max_output_tokens: config.maxTokens,
        stream: Boolean(postStream)
      };
      if (!postStream) {
        const response = await client.request(request);
        return response.output_text || '';
      }

      let fullText = '';
      let index = 0;
      await client.stream(request, (event) => {
        if (event?.type !== 'response.output_text.delta' || typeof event.delta !== 'string') return;
        fullText += event.delta;
        postStream({ chunk: event.delta, index: index++, done: false });
      });
      postStream({ chunk: '', index, done: true });
      return fullText;
    }

    function callLLM() {
      return new Promise((resolve, reject) => {
        const url = new URL(config.apiUrl);
        const isHttps = url.protocol === 'https:';
        const transport = isHttps ? https : http;

        const body = JSON.stringify({
          model: config.modelId,
          messages: messages,
          temperature: config.temperature,
          max_tokens: config.maxTokens,
          stream: !!postStream
        });

        const headers = {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        };
        if (config.apiKey) {
          headers['Authorization'] = 'Bearer ' + config.apiKey;
        }

        const options = {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          method: 'POST',
          headers
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
      const fullText = useResponses ? await callResponses() : await callLLM();
      return { success: true, data: { text: fullText } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
};
