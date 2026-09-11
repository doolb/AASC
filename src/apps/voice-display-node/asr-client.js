/**
 * 服务器端 ASR 客户端
 * 通过 HTTP POST 请求将音频发送到服务器进行语音识别
 */

const fetch = require('node-fetch');
const FormData = require('form-data');
const https = require('https');

const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

class ServerASR {
    constructor(serverURL) {
        this.serverURL = serverURL;
        this.ready = false;
        this.checkReady();
    }

    _getFetchOptions(options = {}) {
        if (this.serverURL.startsWith('https://')) {
            options.agent = httpsAgent;
        }
        return options;
    }

    async checkReady() {
        try {
            const url = `${this.serverURL}/api/asr/status`;
            const response = await fetch(url, this._getFetchOptions({
                method: 'GET',
                timeout: 5000
            }));

            if (!response.ok) {
                console.log('[ASR] 检查ASR状态失败: HTTP', response.status);
                this.ready = false;
                return false;
            }

            const result = await response.json();
            this.ready = result.ready === true;

            if (this.ready) {
                console.log('[ASR] 服务器端 ASR 可用');
            } else {
                console.log('[ASR] 服务器端 ASR 不可用');
            }

            return this.ready;
        } catch (error) {
            console.log('[ASR] 检查ASR状态失败:', error.message);
            this.ready = false;
            return false;
        }
    }

    /**
     * 获取 ASR 是否就绪
     * @returns {boolean}
     */
    isReady() {
        return this.ready;
    }

    /**
     * 刷新 ASR 状态
     * @returns {Promise<boolean>}
     */
    async refreshStatus() {
        return await this.checkReady();
    }

    /**
     * 等待 ASR 就绪
     * @param {number} pollInterval - 轮询间隔（毫秒）
     * @returns {Promise<boolean>}
     */
    async waitForReady(pollInterval = 5000) {
        if (this.ready) {
            return true;
        }

        return new Promise((resolve) => {
            const timer = setInterval(async () => {
                const ready = await this.checkReady();
                if (ready) {
                    clearInterval(timer);
                    resolve(true);
                }
            }, pollInterval);
        });
    }

    /**
     * 识别音频
     * @param {Buffer} wavData - WAV格式的音频数据
     * @param {Object} context - 显示端和 VAD 片段时间信息
     * @returns {Promise<Object>} - 服务端 ASR 完整响应
     */
    async recognize(wavData, context = {}) {
        try {
            const url = `${this.serverURL}/api/asr/recognize`;

            const formData = new FormData();
            formData.append('audio', wavData, {
                filename: 'audio.wav',
                contentType: 'audio/wav'
            });
            if (context.displayId) {
                formData.append('displayId', String(context.displayId));
            }
            if (Number.isFinite(Number(context.speechStartAt))) {
                formData.append('speechStartAt', String(context.speechStartAt));
            }
            if (Number.isFinite(Number(context.speechEndAt))) {
                formData.append('speechEndAt', String(context.speechEndAt));
            }

            const response = await fetch(url, this._getFetchOptions({
                method: 'POST',
                body: formData,
                timeout: 30000
            }));

            if (!response.ok) {
                const body = await response.text();
                throw new Error(`服务器返回错误 ${response.status}: ${body}`);
            }

            const result = await response.json();

            switch (result.status) {
                case 'success':
                    return { ...result, text: result.text || '', status: 'success' };
                case 'ignored':
                    return { ...result, text: '', status: 'ignored' };
                default:
                    throw new Error(`识别失败: ${result.message || '未知错误'}`);
            }
        } catch (error) {
            throw new Error(`识别请求失败: ${error.message}`);
        }
    }

    /**
     * 关闭客户端
     */
    close() {
        this.ready = false;
    }
}

module.exports = ServerASR;
