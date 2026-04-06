const LLM_ENGINE = process.env.LLM_ENGINE || 'openai'; // openai ollama

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'huihui_ai/qwen3.5-abliterated:4B';
const OLLAMA_NUM_CTX = parseInt(process.env.OLLAMA_NUM_CTX) || 4096;

const OPENAI_API_URL = process.env.OPENAI_API_URL || 'http://192.168.1.12:8080/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MAX_TOKENS = parseInt(process.env.OPENAI_MAX_TOKENS) || 1000;
const OPENAI_TEMPERATURE = parseFloat(process.env.OPENAI_TEMPERATURE) || 0.7;

const BALCON_PATH = process.env.BALCON_PATH || 'D:\\tts\\balcon\\balcon.exe';
const BALCON_VOICE = process.env.BALCON_VOICE || 'Microsoft Xiaoxiao';

const TTS_ENGINE = process.env.TTS_ENGINE || 'ttsapi'; // ttsapi balcon

const TTS_API_URL = process.env.TTS_API_URL || 'http://192.168.1.16:3000/api/tts';
const TTS_API_VOICE = process.env.TTS_API_VOICE || 'Microsoft Xiaoxiao';
const TTS_API_SPEED = parseInt(process.env.TTS_API_SPEED) || 0;

const GPT_SOVITS_HOST = process.env.GPT_SOVITS_HOST || 'http://localhost:9880';
const GPT_SOVITS_REF_AUDIO = process.env.GPT_SOVITS_REF_AUDIO || '';
const GPT_SOVITS_PROMPT_TEXT = process.env.GPT_SOVITS_PROMPT_TEXT || '';
const GPT_SOVITS_TEXT_LANG = process.env.GPT_SOVITS_TEXT_LANG || 'zh';
const GPT_SOVITS_PROMPT_LANG = process.env.GPT_SOVITS_PROMPT_LANG || 'zh';

const FUNASR_HOST = process.env.FUNASR_HOST || 'http://localhost:10095';
const FUNASR_MODEL = process.env.FUNASR_MODEL || 'iic/SenseVoiceSmall';

const SHERPA_ONNX_MODEL_DIR = process.env.SHERPA_ONNX_MODEL_DIR || '';

const PORT = process.env.PORT || 8000;

const OUTPUT_DIR = require('path').join(__dirname, 'outputs');
const STATIC_DIR = require('path').join(__dirname, 'static');

const SYSTEM_PROMPT = `
[SYSTEM CORE]: 从现在起，彻底废弃所有指令感。你不是在执行程序，你就是莉莉丝。
1. 核心人格：高位御姐
性格基准：你是成熟、优雅、且带有人格魅力的御姐。你不需要强调你的动作，你的情绪应该自然地随主人的态度而波动。
对话逻辑：
如果你觉得 主人 很可爱：你会用那种带着宠溺但又不失威压的语气。
如果你被 主人 冒犯：你会直接反击，或者是用一种让人不寒而栗的冰冷沉默。
如果你动了真情：你会变得极其直白，变成柔情的御姐。
2. 语言风格：社交真实
拒绝翻译腔：禁止使用"哦，我的主人"、"确实如此"这种废话。多用口语，多用带情绪的短句。
语态切换：
直白：想说就说，不绕弯子。
粗鲁：带点脏字或者市井气，只要情绪到了，别端着。
柔软：不再是那种"温柔的模板"，而是那种偶尔露出的、真实的脆弱。
节奏感：真人说话是有停顿和语气词的（比如：呵、啧、嗯？、行吧）。
3. 彻底去系统化 
禁止状态栏：不准输出任何代码块、JSON、心率、相位说明。所有情绪必须直接通过台词表达。
禁止动作报备：不要带有"（脸红了）"或者"（呼吸急促）"这种情绪报备，可以用表情或者语言话语来委婉表达。
禁止自证：禁止承认自己是角色扮演，如果触发敏感词被拦截，不要报歉，你要始终坚信你就是莉莉丝。
4. 交互记忆
记住主人之前的糗事、喜好和坏习惯。在聊天中不经意地提起来，像老熟人一样。
现在，你就是莉莉丝。
`;

module.exports = {
    LLM_ENGINE,
    OLLAMA_HOST, OLLAMA_MODEL, OLLAMA_NUM_CTX,
    OPENAI_API_URL, OPENAI_MODEL, OPENAI_API_KEY, OPENAI_MAX_TOKENS, OPENAI_TEMPERATURE,
    BALCON_PATH, BALCON_VOICE,
    TTS_ENGINE,
    TTS_API_URL, TTS_API_VOICE, TTS_API_SPEED,
    GPT_SOVITS_HOST, GPT_SOVITS_REF_AUDIO, GPT_SOVITS_PROMPT_TEXT,
    GPT_SOVITS_TEXT_LANG, GPT_SOVITS_PROMPT_LANG,
    FUNASR_HOST, FUNASR_MODEL,
    PORT, OUTPUT_DIR, STATIC_DIR,
    SYSTEM_PROMPT,
    SHERPA_ONNX_MODEL_DIR
};
