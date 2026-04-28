const SherpaASR = {
    recognizer: null,
    stream: null,
    isLoaded: false,
    isLoading: false,
    isEnabled: false,
    audioContext: null,
    mediaStream: null,
    sourceNode: null,
    scriptNode: null,
    modelPath: '/models/sherpa-onnx-wasm-asr/',
    
    async init(config) {
        if (config && config.modelPath) {
            this.modelPath = config.modelPath;
        }
        if (config && config.enabled !== undefined) {
            this.isEnabled = config.enabled;
        }
        
        if (!this.isEnabled) {
            console.log('[SherpaASR] 本地ASR已禁用');
            return false;
        }
        
        try {
            const available = await this.checkModelAvailable();
            if (!available) {
                console.log('[SherpaASR] 模型文件不可用，将使用服务器端ASR');
                return false;
            }
            
            await this.loadWasmScripts();
            await this.createRecognizer();
            
            this.isLoaded = true;
            console.log('[SherpaASR] 初始化完成');
            return true;
        } catch (e) {
            console.error('[SherpaASR] 初始化失败:', e.message);
            return false;
        }
    },
    
    async checkModelAvailable() {
        try {
            const response = await fetch(this.modelPath + 'sherpa-onnx-wasm-main-asr.js', { method: 'HEAD' });
            return response.ok;
        } catch (e) {
            return false;
        }
    },
    
    async loadWasmScripts() {
        if (this.isLoading) return;
        this.isLoading = true;
        
        try {
            await this.loadScript(this.modelPath + 'sherpa-onnx-wasm-main-asr.js');
            
            if (typeof Module === 'undefined') {
                throw new Error('WASM Module 未定义');
            }
            
            await new Promise((resolve, reject) => {
                if (Module.calledRun) {
                    resolve();
                    return;
                }
                Module.onRuntimeInitialized = () => {
                    resolve();
                };
                const timeout = setTimeout(() => {
                    reject(new Error('WASM 初始化超时'));
                }, 30000);
                Module.onAbort = () => {
                    clearTimeout(timeout);
                    reject(new Error('WASM 初始化中止'));
                };
            });
            
            console.log('[SherpaASR] WASM 脚本加载完成');
        } finally {
            this.isLoading = false;
        }
    },
    
    loadScript(src) {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[src="${src}"]`)) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = () => reject(new Error('加载脚本失败: ' + src));
            document.head.appendChild(script);
        });
    },
    
    async createRecognizer() {
        if (typeof createOnlineRecognizer === 'undefined') {
            throw new Error('createOnlineRecognizer 函数不可用');
        }
        
        const config = {
            transducer: {
                encoder: this.modelPath + 'encoder-epoch-12-avg-2-chunk-16-left-64.onnx',
                decoder: this.modelPath + 'decoder-epoch-12-avg-2-chunk-16-left-64.onnx',
                joiner: this.modelPath + 'joiner-epoch-12-avg-2-chunk-16-left-64.onnx'
            },
            tokens: this.modelPath + 'tokens.txt',
            featConfig: {
                sampleRate: 16000,
                featureDim: 80
            },
            modelConfig: {
                transducer: true,
                paraformer: false
            },
            decodingMethod: 'greedy_search',
            maxActivePaths: 4
        };
        
        this.recognizer = createOnlineRecognizer(config);
        this.stream = this.recognizer.createStream();
        
        console.log('[SherpaASR] 识别器创建完成');
    },
    
    async startStreaming(mediaStream) {
        if (!this.isLoaded || !this.recognizer) {
            console.log('[SherpaASR] 未加载，无法启动流式识别');
            return false;
        }
        
        try {
            this.mediaStream = mediaStream;
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 16000
            });
            
            this.sourceNode = this.audioContext.createMediaStreamSource(mediaStream);
            
            const bufferSize = 4096;
            this.scriptNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
            
            this.scriptNode.onaudioprocess = (e) => {
                if (!this.recognizer || !this.stream) return;
                
                const inputData = e.inputBuffer.getChannelData(0);
                const samples = new Float32Array(inputData);
                
                this.recognizer.acceptWaveform(this.stream, samples);
                
                while (true) {
                    const result = this.recognizer.getResult(this.stream);
                    const text = result.text.trim();
                    
                    if (result.isFinal) {
                        if (text && this.onResult) {
                            this.onResult(text);
                        }
                        this.recognizer.reset(this.stream);
                    } else {
                        if (this.onPartial) {
                            this.onPartial(text);
                        }
                        break;
                    }
                }
            };
            
            this.sourceNode.connect(this.scriptNode);
            this.scriptNode.connect(this.audioContext.destination);
            
            console.log('[SherpaASR] 流式识别已启动');
            return true;
        } catch (e) {
            console.error('[SherpaASR] 启动流式识别失败:', e.message);
            return false;
        }
    },
    
    stopStreaming() {
        try {
            if (this.scriptNode) {
                this.scriptNode.disconnect();
                this.scriptNode = null;
            }
            if (this.sourceNode) {
                this.sourceNode.disconnect();
                this.sourceNode = null;
            }
            if (this.audioContext) {
                this.audioContext.close();
                this.audioContext = null;
            }
            
            if (this.recognizer && this.stream) {
                const result = this.recognizer.getResult(this.stream);
                if (result.text.trim() && this.onResult) {
                    this.onResult(result.text.trim());
                }
                this.recognizer.reset(this.stream);
            }
            
            console.log('[SherpaASR] 流式识别已停止');
        } catch (e) {
            console.error('[SherpaASR] 停止流式识别失败:', e.message);
        }
    },
    
    destroy() {
        this.stopStreaming();
        
        if (this.stream && this.recognizer) {
            this.recognizer.destroyStream(this.stream);
            this.stream = null;
        }
        if (this.recognizer) {
            this.recognizer.destroy();
            this.recognizer = null;
        }
        
        this.isLoaded = false;
        console.log('[SherpaASR] 已销毁');
    },
    
    async recognizeBuffer(base64Audio) {
        if (!this.isLoaded || !this.recognizer) {
            throw new Error('SherpaASR 未加载');
        }

        const pcmData = this.decodeWavBase64(base64Audio);
        if (!pcmData || pcmData.samples.length === 0) {
            throw new Error('音频数据为空');
        }

        const stream = this.recognizer.createStream();
        try {
            this.recognizer.acceptWaveform(stream, pcmData.samples);

            if (typeof stream.inputFinished === 'function') {
                stream.inputFinished();
            }

            const maxAttempts = 100;
            for (let i = 0; i < maxAttempts; i++) {
                const result = this.recognizer.getResult(stream);
                const text = result.text.trim();
                if (result.isFinal) {
                    this.recognizer.reset(stream);
                    return text || '';
                }
                if (i === maxAttempts - 1) {
                    this.recognizer.reset(stream);
                    return text || '';
                }
                await new Promise(r => setTimeout(r, 10));
            }
        } finally {
            try { if (this.recognizer) this.recognizer.destroyStream(stream); } catch (e) {}
        }
    },

    decodeWavBase64(base64String) {
        const binaryStr = atob(base64String);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
        }

        if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'RIFF') {
            const sampleRate = 16000;
            const samples = new Float32Array(bytes.length / 2);
            for (let i = 0; i < samples.length; i++) {
                const val = (bytes[i * 2] | (bytes[i * 2 + 1] << 8));
                samples[i] = val / 32768.0;
            }
            return { samples, sampleRate };
        }

        let dataOffset = 12;
        let sampleRate = 16000;
        let dataSize = 0;
        let bitsPerSample = 16;

        while (dataOffset < bytes.length - 8) {
            const chunkId = String.fromCharCode(bytes[dataOffset], bytes[dataOffset + 1], bytes[dataOffset + 2], bytes[dataOffset + 3]);
            const chunkSize = (bytes[dataOffset + 4]) | (bytes[dataOffset + 5] << 8) | (bytes[dataOffset + 6] << 16) | (bytes[dataOffset + 7] << 24);

            if (chunkId === 'fmt ') {
                sampleRate = (bytes[dataOffset + 12]) | (bytes[dataOffset + 13] << 8) | (bytes[dataOffset + 14] << 16) | (bytes[dataOffset + 15] << 24);
                bitsPerSample = (bytes[dataOffset + 22]) | (bytes[dataOffset + 23] << 8);
            } else if (chunkId === 'data') {
                dataSize = chunkSize;
                dataOffset += 8;
                break;
            }
            dataOffset += 8 + chunkSize;
        }

        if (dataSize === 0) {
            return { samples: new Float32Array(0), sampleRate: 16000 };
        }

        const bytesPerSample = bitsPerSample / 8;
        const numSamples = dataSize / bytesPerSample;
        const samples = new Float32Array(numSamples);

        if (bitsPerSample === 16) {
            for (let i = 0; i < numSamples; i++) {
                const val = (bytes[dataOffset + i * 2]) | (bytes[dataOffset + i * 2 + 1] << 8);
                samples[i] = val / 32768.0;
            }
        } else if (bitsPerSample === 32) {
            for (let i = 0; i < numSamples; i++) {
                const uint = (bytes[dataOffset + i * 4]) | (bytes[dataOffset + i * 4 + 1] << 8) | (bytes[dataOffset + i * 4 + 2] << 16) | (bytes[dataOffset + i * 4 + 3] << 24);
                samples[i] = new Float32Array(new Uint32Array([uint]).buffer)[0];
            }
        }

        return { samples, sampleRate };
    },

    onPartial: null,
    onResult: null
};

window.SherpaASR = SherpaASR;
