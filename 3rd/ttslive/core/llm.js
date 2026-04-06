const http = require('http');
const config = require('../config');

class LLMWrapper {
    constructor() {
        this.host = config.OLLAMA_HOST;
        this.model = config.OLLAMA_MODEL;
        this.systemPrompt = config.SYSTEM_PROMPT;
        this.numCtx = config.OLLAMA_NUM_CTX;
        console.log(`LLM 初始化: ${this.host}, 模型: ${this.model}, 上下文长度: ${this.numCtx}`);
    }

    async *inferenceStream(messages) {
        const fullMessages = [
            { role: 'system', content: this.systemPrompt },
            ...messages
        ];

        const requestBody = JSON.stringify({
            model: this.model,
            messages: fullMessages,
            stream: true,
            options: {
                temperature: 0.6,
                top_p: 0.95,
                num_ctx: this.numCtx
            }
        });

        const url = new URL(`${this.host}/api/chat`);
        
        const options = {
            hostname: url.hostname,
            port: url.port || 11434,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(requestBody)
            }
        };

        const response = await new Promise((resolve, reject) => {
            const req = http.request(options, resolve);
            req.on('error', reject);
            req.write(requestBody);
            req.end();
        });

        let buffer = '';
        
        for await (const chunk of response) {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            
            for (const line of lines) {
                if (line.trim()) {
                    try {
                        const data = JSON.parse(line);
                        if (data.message && data.message.content) {
                            yield data.message.content;
                        }
                    } catch (e) {
                        // 忽略解析错误
                    }
                }
            }
        }
        
        if (buffer.trim()) {
            try {
                const data = JSON.parse(buffer);
                if (data.message && data.message.content) {
                    yield data.message.content;
                }
            } catch (e) {
                // 忽略解析错误
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

module.exports = LLMWrapper;
