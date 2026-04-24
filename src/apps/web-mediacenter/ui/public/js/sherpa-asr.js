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
    
    onPartial: null,
    onResult: null
};

window.SherpaASR = SherpaASR;
