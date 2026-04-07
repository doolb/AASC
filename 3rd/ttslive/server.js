const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { v4: uuidv4 } = require('uuid');

const config = require('./config');
const LLMWrapper = require('./core/llm');
const OpenAILLMWrapper = require('./core/llm_openai');
const BalconTTS = require('./core/tts');
const GPTSoVITSTTS = require('./core/tts_gptsovits');
const TTSApiWrapper = require('./core/tts_api');
const FunASRWrapper = require('./core/asr');

const app = express();

app.use(cors());
app.use(express.json());

if (!fs.existsSync(config.OUTPUT_DIR)) {
    fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });
}

app.use('/static', express.static(config.STATIC_DIR));
app.use('/outputs', express.static(config.OUTPUT_DIR));

const ollamaLLM = new LLMWrapper();
const openaiLLM = new OpenAILLMWrapper();

let currentLLMEngine = config.LLM_ENGINE;

function getLLM() {
    return currentLLMEngine === 'openai' ? openaiLLM : ollamaLLM;
}

let llm = getLLM();

const balconTTS = new BalconTTS();
const gptsovitsTTS = new GPTSoVITSTTS();
const ttsApiTTS = new TTSApiWrapper();

let currentTTSEngine = config.TTS_ENGINE;

function getTTS() {
    switch (currentTTSEngine) {
        case 'gptsovits':
            return gptsovitsTTS;
        case 'ttsapi':
            return ttsApiTTS;
        default:
            return balconTTS;
    }
}

let tts = getTTS();

const asr = new FunASRWrapper();

let conversationHistory = [];
let currentSessionId = null;

const SENTENCE_DELIMITERS = new Set([',', '，', '。', '！', '？', '；', '.', '!', '?', ';', '\n', '~', '～', '…', '"']);

const IGNORED_PATTERNS = [
    /^(the|a|an|is|are|was|were|it|this|that|so|um|uh|oh|ah|yeah|yes|no|ok|okay|hey|hi|hello)[.!?]?$/i,
    /^[a-z]{1,3}[.!?]?$/i,
    /^[\s\p{P}]+$/u,
    /^[\s.!?，。！？、]+$/
];

function hasValidContent(text) {
    const hasChinese = /[\u4e00-\u9fa5]/.test(text);
    const hasEnglish = /[a-zA-Z]/.test(text);
    const hasNumber = /[0-9]/.test(text);
    
    if (!hasChinese && !hasEnglish && !hasNumber) {
        return false;
    }
    
    const trimmed = text.trim().toLowerCase();
    
    for (const pattern of IGNORED_PATTERNS) {
        if (pattern.test(trimmed)) {
            console.log(`🔇 屏蔽无效输入: "${text}" 匹配规则: ${pattern}`);
            return false;
        }
    }
    
    const wordCount = trimmed.split(/\s+/).filter(w => w.length > 0).length;
    if (hasEnglish && !hasChinese && wordCount < 2) {
        const cleanWord = trimmed.replace(/[.!?，。！？]/g, '');
        if (cleanWord.length < 4) {
            console.log(`🔇 屏蔽短输入: "${text}"`);
            return false;
        }
    }
    
    if (hasChinese) {
        const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || [];
        if (chineseChars.length < 2) {
            console.log(`🔇 屏蔽短中文输入: "${text}"`);
            return false;
        }
    }
    
    return true;
}

function cleanupOldAudioFiles() {
    const now = Date.now();
    const tenMinutesAgo = now - 10 * 60 * 1000;
    
    try {
        const files = fs.readdirSync(config.OUTPUT_DIR);
        let deletedCount = 0;
        
        for (const file of files) {
            if (!file.endsWith('.wav')) continue;
            
            const filePath = path.join(config.OUTPUT_DIR, file);
            try {
                const stat = fs.statSync(filePath);
                if (stat.mtimeMs < tenMinutesAgo) {
                    fs.unlinkSync(filePath);
                    deletedCount++;
                }
            } catch (e) {
                // ignore
            }
        }
        
        if (deletedCount > 0) {
            console.log(`🧹 清理过期音频文件: ${deletedCount} 个`);
        }
    } catch (e) {
        console.error('清理音频文件失败:', e);
    }
}

setInterval(cleanupOldAudioFiles, 5 * 60 * 1000);

function printTTSDialog(role, text) {
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const prefix = role === 'user' ? '👤 用户' : '🤖 助手';
    console.log(`\n[${timestamp}] ${prefix}:`);
    console.log(`  ${text}`);
}

function cleanTextForTTS(text) {
    if (text.includes('助手:') || text.includes('助手：')) {
        const parts = text.split(/助手[：:]\s*/);
        if (parts.length > 1) {
            let lastResponse = parts[parts.length - 1];
            lastResponse = lastResponse.split(/\n\s*用户[：:]/)[0];
            text = lastResponse;
        }
    }
    text = text.replace(/^(用户|助手|User|Assistant)[：:]\s*/gm, '');
    return text.trim();
}

async function* processStreaming(userText) {
    conversationHistory.push({ role: 'user', content: userText });
    printTTSDialog('user', userText);
    
    const contextMessages = conversationHistory.slice(-6);
    
    let buffer = '';
    let fullResponse = '';
    let audioIndex = 0;
    let inThinkTag = false;
    
    const sessionId = uuidv4().slice(0, 8);
    currentSessionId = sessionId;
    
    yield `data: ${JSON.stringify({ type: 'start', session_id: sessionId })}\n\n`;
    
    try {
        for await (const chunk of llm.inferenceStream(contextMessages)) {
            if (currentSessionId !== sessionId) {
                console.log(`⏹️ 会话 ${sessionId} 被中断`);
                yield `data: ${JSON.stringify({ type: 'interrupted' })}\n\n`;
                return;
            }
            
            fullResponse += chunk;
            
            yield `data: ${JSON.stringify({ type: 'text', content: chunk, session_id: sessionId })}\n\n`;
            
            if (chunk.includes('<think')) {
                inThinkTag = true;
                const beforeThink = chunk.split(/<think[^>]*>/)[0];
                if (beforeThink) buffer += beforeThink;
                continue;
            }
            
            if (inThinkTag && chunk.includes('>')) {
                inThinkTag = false;
                const afterThink = chunk.split('>').pop();
                if (afterThink) buffer += afterThink;
                continue;
            }
            
            if (inThinkTag) continue;
            
            buffer += chunk;
            
            while (true) {
                let delimiterPos = -1;
                for (let i = 0; i < buffer.length; i++) {
                    if (SENTENCE_DELIMITERS.has(buffer[i])) {
                        delimiterPos = i;
                        break;
                    }
                }
                
                if (delimiterPos === -1) break;
                
                const sentence = buffer.slice(0, delimiterPos + 1);
                buffer = buffer.slice(delimiterPos + 1);
                
                const cleanText = cleanTextForTTS(sentence).trim();
                if (cleanText && cleanText.length > 0) {
                    console.log(`  📢 TTS 句子[${audioIndex}]: ${cleanText}`);
                    const audioFilename = `${sessionId}_${audioIndex}.wav`;
                    const audioPath = path.join(config.OUTPUT_DIR, audioFilename);
                    
                    try {
                        await tts.synthesize(cleanText, audioPath);
                        console.log(`  ✅ TTS 完成[${audioIndex}]: ${audioFilename}`);
                        yield `data: ${JSON.stringify({ 
                            type: 'audio', 
                            url: `/outputs/${audioFilename}`, 
                            text: cleanText,
                            session_id: sessionId
                        })}\n\n`;
                        audioIndex++;
                    } catch (err) {
                        console.error('  ❌ TTS Error:', err);
                    }
                }
            }
        }
        
        if (buffer.trim()) {
            const cleanText = cleanTextForTTS(buffer).trim();
            if (cleanText && cleanText.length > 0) {
                console.log(`  📢 TTS 句子[${audioIndex}]: ${cleanText}`);
                const audioFilename = `${sessionId}_${audioIndex}.wav`;
                const audioPath = path.join(config.OUTPUT_DIR, audioFilename);
                
                try {
                    await tts.synthesize(cleanText, audioPath);
                    yield `data: ${JSON.stringify({ 
                        type: 'audio', 
                        url: `/outputs/${audioFilename}`, 
                        text: cleanText,
                        session_id: sessionId
                    })}\n\n`;
                } catch (err) {
                    console.error('TTS Error:', err);
                }
            }
        }
        
        const cleanResponse = cleanTextForTTS(fullResponse);
        conversationHistory.push({ role: 'assistant', content: cleanResponse.trim() });
        printTTSDialog('assistant', cleanResponse);
        
        yield `data: ${JSON.stringify({ type: 'end', full_response: cleanResponse })}\n\n`;
        
    } catch (err) {
        console.error('Stream Error:', err);
        yield `data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`;
    }
}

app.get('/', (req, res) => {
    res.sendFile(path.join(config.STATIC_DIR, 'index.html'));
});

app.post('/chat', async (req, res) => {
    const { text, tts_engine, llm_engine } = req.body;
    console.log(`收到文本请求: ${text}`);
    
    if (llm_engine && llm_engine !== currentLLMEngine) {
        currentLLMEngine = llm_engine;
        llm = getLLM();
        console.log(`切换 LLM 引擎: ${currentLLMEngine}`);
    }
    
    if (tts_engine && tts_engine !== currentTTSEngine) {
        currentTTSEngine = tts_engine;
        tts = getTTS();
        console.log(`切换 TTS 引擎: ${currentTTSEngine}`);
    }
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    try {
        for await (const event of processStreaming(text)) {
            res.write(event);
        }
    } catch (err) {
        console.error('Chat Error:', err);
    }
    
    res.end();
});

const upload = multer({ dest: config.OUTPUT_DIR });

app.post('/audio', upload.single('audio'), async (req, res) => {
    console.log('\n========================================');
    console.log('收到音频请求');
    
    const speechOffset = parseFloat(req.body.speechOffset) || 0;
    console.log(`语音开始于: ${speechOffset}ms (${(speechOffset / 1000).toFixed(3)}秒)`);
    
    //if (req.file) {
    //    console.log(`音频文件路径: ${req.file.path}`);
    //    console.log(`原始文件名: ${req.file.originalname}`);
    //    console.log(`文件大小: ${(req.file.size / 1024).toFixed(2)} KB`);
    //    console.log(`MIME 类型: ${req.file.mimetype}`);
    //}
    //console.log('========================================\n');
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    try {
        if (!req.file) {
            res.write(`data: ${JSON.stringify({ type: 'error', message: '未收到音频文件' })}\n\n`);
            res.end();
            return;
        }
        
        res.write(`data: ${JSON.stringify({ type: 'status', message: '正在识别语音...' })}\n\n`);
        
        let recognizedText = '';
        try {
            recognizedText = await asr.recognize(req.file.path);
            console.log(`ASR 识别结果: ${recognizedText}`);
            res.write(`data: ${JSON.stringify({ type: 'asr', text: recognizedText })}\n\n`);
        } catch (asrErr) {
            console.error('ASR 错误:', asrErr);
            res.write(`data: ${JSON.stringify({ type: 'error', message: `语音识别失败: ${asrErr.message}` })}\n\n`);
            res.end();
            fs.unlinkSync(req.file.path);
            return;
        }
        fs.unlinkSync(req.file.path);
        if (!recognizedText.trim()) {
            res.write(`data: ${JSON.stringify({ type: 'error', message: '未识别到有效语音' })}\n\n`);
            res.end();
            return;
        }
        
        if (!hasValidContent(recognizedText)) {
            console.log(`忽略无效语音输入: ${recognizedText}`);
            res.write(`data: ${JSON.stringify({ type: 'ignored', message: '未检测到有效内容' })}\n\n`);
            res.end();
            return;
        }
        
        for await (const event of processStreaming(recognizedText)) {
            res.write(event);
        }
        
    } catch (err) {
        console.error('Audio Error:', err);
        res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    }
    
    res.end();
});

app.get('/history', (req, res) => {
    res.json({ history: conversationHistory });
});

app.get('/config', (req, res) => {
    res.json({
        llmEngine: currentLLMEngine,
        ttsEngine: currentTTSEngine
    });
});

app.delete('/history', (req, res) => {
    conversationHistory = [];
    res.json({ status: 'ok' });
});

app.get('/reference-audios', (req, res) => {
    res.json({ audios: gptsovitsTTS.getReferenceAudios() });
});

app.post('/set-reference', (req, res) => {
    const { audioPath, promptText } = req.body;
    
    currentTTSEngine = 'gptsovits';
    tts = getTTS();
    
    if (tts.setReference) {
        tts.setReference(audioPath, promptText);
        res.json({ status: 'ok', audioPath, promptText, engine: 'gptsovits' });
    } else {
        res.status(400).json({ error: '当前 TTS 引擎不支持设置参考音频' });
    }
});

const sslKeyPath = path.join(__dirname, 'ssl', 'key.pem');
const sslCertPath = path.join(__dirname, 'ssl', 'cert.pem');

if (fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath)) {
    const sslOptions = {
        key: fs.readFileSync(sslKeyPath),
        cert: fs.readFileSync(sslCertPath)
    };
    https.createServer(sslOptions, app).listen(config.PORT, '0.0.0.0', () => {
        console.log(`HTTPS 服务器已启动: https://0.0.0.0:${config.PORT}`);
        printStartupInfo();
    });
} else {
    app.listen(config.PORT, '0.0.0.0', () => {
        console.log(`HTTP 服务器已启动: http://0.0.0.0:${config.PORT}`);
        console.log(`⚠️  麦克风功能需要 HTTPS 或 localhost 访问`);
        console.log(`   如需 HTTPS，请在 ssl/ 目录放置 key.pem 和 cert.pem`);
        printStartupInfo();
    });
}

function printStartupInfo() {
    console.log(`LLM 引擎: ${config.LLM_ENGINE}`);
    if (config.LLM_ENGINE === 'openai') {
        console.log(`OpenAI API: ${config.OPENAI_API_URL}`);
        console.log(`OpenAI 模型: ${config.OPENAI_MODEL}`);
    } else {
        console.log(`Ollama 模型: ${config.OLLAMA_MODEL}`);
    }
    console.log(`TTS 引擎: ${config.TTS_ENGINE}`);
    if (config.TTS_ENGINE === 'gptsovits') {
        console.log(`GPT-SoVITS 地址: ${config.GPT_SOVITS_HOST}`);
    } else if (config.TTS_ENGINE === 'ttsapi') {
        console.log(`TTS-API 地址: ${config.TTS_API_URL}`);
        console.log(`TTS-API 语音: ${config.TTS_API_VOICE}`);
    } else {
        console.log(`TTS 语音: ${config.BALCON_VOICE}`);
    }
}
