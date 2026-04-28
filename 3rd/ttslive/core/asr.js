const fs = require('fs');
const path = require('path');
const config = require('../config');

let sherpaOnnx = null;
let recognizer = null;

try {
    sherpaOnnx = require('sherpa-onnx-node');
} catch (e) {
    console.log('[ASR] sherpa-onnx-node 未安装，请运行: npm install sherpa-onnx-node');
}

class SherpaOnnxASR {
    constructor() {
        this.modelDir = config.SHERPA_ONNX_MODEL_DIR || path.join(__dirname, '../models/sensevoice');
        this.initialized = false;
        
        console.log(`\n🎤 Sherpa-ONNX ASR 初始化:`);
        console.log(`  模型目录: ${this.modelDir}`);
        
        if (sherpaOnnx) {
            this.initRecognizer();
        } else {
            console.log(`  ⚠️  sherpa-onnx-node 未安装`);
        }
        console.log('');
    }

    initRecognizer() {
        try {
            const modelPath = path.join(this.modelDir, 'model.int8.onnx');
            const tokensPath = path.join(this.modelDir, 'tokens.txt');
            
            if (!fs.existsSync(modelPath)) {
                console.log(`  ⚠️  模型文件不存在: ${modelPath}`);
                return;
            }
            
            if (!fs.existsSync(tokensPath)) {
                console.log(`  ⚠️  tokens.txt 不存在: ${tokensPath}`);
                return;
            }

            const config = {
                featConfig: {
                    sampleRate: 16000
                },
                modelConfig: {
                    senseVoice: {
                        model: modelPath,
                        language: 'auto',
                        useInverseTextNormalization: 1
                    },
                    tokens: tokensPath,
                    numThreads: 1,
                    debug: false,
                    provider: 'cpu'
                }
            };

            recognizer = new sherpaOnnx.OfflineRecognizer(config);
            
            this.initialized = true;
            console.log(`  ✅ SenseVoice 模型加载成功`);
        } catch (e) {
            console.error(`  ❌ 模型加载失败: ${e.message}`);
        }
    }

    recognize(audioPath) {
        return new Promise((resolve, reject) => {
            if (!this.initialized || !recognizer) {
                reject(new Error('ASR 未初始化'));
                return;
            }

            try {
                const stream = recognizer.createStream();
                const audioData = this.readWavFile(audioPath);
                
                stream.acceptWaveform({
                    samples: audioData.samples,
                    sampleRate: audioData.sampleRate
                });
                recognizer.decode(stream);
                
                const result = recognizer.getResult(stream);
                resolve(result.text || '');
            } catch (e) {
                reject(new Error(`ASR 识别失败: ${e.message}`));
            }
        });
    }

    readWavFile(filePath) {
        const buffer = fs.readFileSync(filePath);
        
        if (buffer.toString('ascii', 0, 4) !== 'RIFF') {
            return this.convertAudioFile(filePath);
        }
        
        let dataOffset = 12;
        let sampleRate = 16000;
        let dataSize = 0;
        let bitsPerSample = 16;
        
        while (dataOffset < buffer.length - 8) {
            const chunkId = buffer.toString('ascii', dataOffset, dataOffset + 4);
            const chunkSize = buffer.readUInt32LE(dataOffset + 4);
            
            if (chunkId === 'fmt ') {
                sampleRate = buffer.readUInt32LE(dataOffset + 12);
                bitsPerSample = buffer.readUInt16LE(dataOffset + 22);
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
        
        const audioData = buffer.slice(dataOffset, dataOffset + dataSize);
        const samples = new Float32Array(audioData.length / (bitsPerSample / 8));
        
        if (bitsPerSample === 16) {
            for (let i = 0; i < samples.length; i++) {
                samples[i] = audioData.readInt16LE(i * 2) / 32768.0;
            }
        } else if (bitsPerSample === 32) {
            for (let i = 0; i < samples.length; i++) {
                samples[i] = audioData.readFloatLE(i * 4);
            }
        }
        
        return { samples, sampleRate };
    }
    
    convertAudioFile(filePath) {
        const { execSync } = require('child_process');
        const outputPath = filePath + '.converted.wav';
        
        try {
            execSync(`ffmpeg -y -i "${filePath}" -ar 16000 -ac 1 -f wav "${outputPath}"`, { stdio: 'pipe' });
            const buffer = fs.readFileSync(outputPath);
            fs.unlinkSync(outputPath);
            
            let dataOffset = 12;
            let sampleRate = 16000;
            let dataSize = 0;
            
            while (dataOffset < buffer.length - 8) {
                const chunkId = buffer.toString('ascii', dataOffset, dataOffset + 4);
                const chunkSize = buffer.readUInt32LE(dataOffset + 4);
                
                if (chunkId === 'fmt ') {
                    sampleRate = buffer.readUInt32LE(dataOffset + 12);
                } else if (chunkId === 'data') {
                    dataSize = chunkSize;
                    dataOffset += 8;
                    break;
                }
                dataOffset += 8 + chunkSize;
            }
            
            const audioData = buffer.slice(dataOffset, dataOffset + dataSize);
            const samples = new Float32Array(audioData.length / 2);
            
            for (let i = 0; i < samples.length; i++) {
                samples[i] = audioData.readInt16LE(i * 2) / 32768.0;
            }
            
            return { samples, sampleRate };
        } catch (e) {
            return { samples: new Float32Array(0), sampleRate: 16000 };
        }
    }
}

module.exports = SherpaOnnxASR;