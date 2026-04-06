const http = require('http');
const https = require('https');
const config = require('../config');

class OpenAILLMWrapper {
    constructor() {
        this.apiUrl = config.OPENAI_API_URL;
        this.model = config.OPENAI_MODEL;
        this.apiKey = config.OPENAI_API_KEY;
        this.maxTokens = config.OPENAI_MAX_TOKENS;
        this.temperature = config.OPENAI_TEMPERATURE;
        this.systemPrompt = config.SYSTEM_PROMPT;
        
        console.log(`\n🌐 OpenAI LLM 初始化:`);
        console.log(`  API地址: ${this.apiUrl}`);
        console.log(`  模型: ${this.model}`);
        console.log(`  最大Token: ${this.maxTokens}`);
        console.log(`  温度: ${this.temperature}`);
        console.log('');
    }

    async *inferenceStream(messages) {
        const fullMessages = [
            { role: 'system', content: this.systemPrompt },
            ...messages
        ];

        const requestBody = JSON.stringify({
            model: this.model,
            messages: fullMessages,
            max_tokens: this.maxTokens,
            temperature: this.temperature,
            stream: true
        });

        const urlObj = new URL(this.apiUrl);
        const isHttps = urlObj.protocol === 'https:';
        const httpModule = isHttps ? https : http;

        const headers = {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(requestBody)
        };

        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: headers
        };

        const response = await new Promise((resolve, reject) => {
            const req = httpModule.request(options, resolve);
            req.on('error', reject);
            req.setTimeout(60000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
            req.write(requestBody);
            req.end();
        });

        let buffer = '';

        for await (const chunk of response) {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('data: ')) {
                    const data = trimmed.slice(6);
                    if (data === '[DONE]') {
                        return;
                    }
                    try {
                        const parsed = JSON.parse(data);
                        const content = parsed.choices?.[0]?.delta?.content;
                        if (content) {
                            yield content;
                        }
                    } catch (e) {
                        // 忽略解析错误
                    }
                }
            }
        }

        if (buffer.trim()) {
            const trimmed = buffer.trim();
            if (trimmed.startsWith('data: ')) {
                const data = trimmed.slice(6);
                if (data !== '[DONE]') {
                    try {
                        const parsed = JSON.parse(data);
                        const content = parsed.choices?.[0]?.delta?.content;
                        if (content) {
                            yield content;
                        }
                    } catch (e) {
                        // 忽略解析错误
                    }
                }
            }
        }
    }

    async inference(messages) {
        let result = '';
        for await (const chunk of this.inferenceStream(messages)) {
            result += chunk;
        }
        return result;
    }
}

module.exports = OpenAILLMWrapper;
