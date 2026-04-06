const path = require('path');
const fs = require('fs');
const SherpaOnnxASR = require('./core/asr');

const testWavsDir = path.join(__dirname, 'models/sensevoice/test_wavs');

async function testASR() {
    console.log('=== ASR 测试脚本 ===\n');
    
    const asr = new SherpaOnnxASR();
    
    if (!asr.initialized) {
        console.log('❌ ASR 初始化失败，无法继续测试');
        process.exit(1);
    }
    
    console.log('\n开始测试音频文件...\n');
    
    const testFiles = fs.readdirSync(testWavsDir).filter(f => f.endsWith('.wav'));
    
    for (const file of testFiles) {
        const filePath = path.join(testWavsDir, file);
        console.log(`📁 测试文件: ${file}`);
        
        try {
            const result = await asr.recognize(filePath);
            console.log(`✅ 识别结果: ${result}`);
        } catch (e) {
            console.log(`❌ 识别失败: ${e.message}`);
        }
        console.log('');
    }
    
    console.log('=== 测试完成 ===');
}

testASR().catch(console.error);
