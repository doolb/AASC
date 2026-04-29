const assert = require('assert');

console.log('=== audioChunk 会话管理自测 ===\n');

let testCount = 0;
let passCount = 0;

function test(name, fn) {
    testCount++;
    try {
        fn();
        passCount++;
        console.log(`✓ ${name}`);
    } catch (err) {
        console.log(`✗ ${name}`);
        console.log(`  错误: ${err.message}`);
    }
}

// 模拟 audioChunk 会话池 // 与 server-app.js 中的逻辑一致
function createAudioSessionPool(timeoutMs = 30000) {
    const sessions = new Map();
    return {
        sessions,
        handleChunk(requestId, chunk, isLast, onComplete, onTimeout) {
            if (!requestId || !chunk) return null;

            let session = sessions.get(requestId);
            if (!session) {
                const timer = setTimeout(() => {
                    sessions.delete(requestId);
                    if (onTimeout) onTimeout(requestId);
                }, timeoutMs);
                session = { chunks: [], timer, lastSeen: Date.now() };
                sessions.set(requestId, session);
            }
            session.lastSeen = Date.now();
            session.chunks.push(Buffer.from(chunk, 'base64'));

            if (isLast) {
                clearTimeout(session.timer);
                sessions.delete(requestId);
                const fullBuffer = Buffer.concat(session.chunks);
                if (onComplete) onComplete(fullBuffer);
                return fullBuffer;
            }
            return null;
        }
    };
}

// ==========================================
// 1. 分片累积
// ==========================================
console.log('--- 1. 分片累积 ---\n');

test('非最后一片不触发完成回调', () => {
    const pool = createAudioSessionPool();
    let completed = false;
    const chunkBase64 = Buffer.from('audio-data').toString('base64');
    pool.handleChunk('req-1', chunkBase64, false, () => { completed = true; });
    assert.strictEqual(completed, false, 'isLast=false 时不触发完成');
});

test('最后一片触发完成回调', () => {
    const pool = createAudioSessionPool();
    let completed = false;
    let resultBuffer = null;
    const chunkBase64 = Buffer.from('audio-data').toString('base64');
    pool.handleChunk('req-1', chunkBase64, true, (buf) => {
        completed = true;
        resultBuffer = buf;
    });
    assert.ok(completed, 'isLast=true 时触发完成');
    assert.ok(resultBuffer instanceof Buffer);
});

test('多分片合并', () => {
    const pool = createAudioSessionPool();
    let result = null;
    pool.handleChunk('req-1', Buffer.from('hello ').toString('base64'), false);
    pool.handleChunk('req-1', Buffer.from('world').toString('base64'), false);
    pool.handleChunk('req-1', Buffer.from('!').toString('base64'), true, (buf) => { result = buf; });
    assert.ok(result, '合并完成');
    assert.strictEqual(result.toString(), 'hello world!');
});

// ==========================================
// 2. requestId 隔离
// ==========================================
console.log('\n--- 2. requestId 隔离 ---\n');

test('不同 requestId 的会话隔离', () => {
    const pool = createAudioSessionPool();
    let result1 = null, result2 = null;
    pool.handleChunk('req-a', Buffer.from('aaa').toString('base64'), false);
    pool.handleChunk('req-b', Buffer.from('bbb').toString('base64'), false);
    pool.handleChunk('req-a', Buffer.from('AAA').toString('base64'), true, (buf) => { result1 = buf; });
    pool.handleChunk('req-b', Buffer.from('BBB').toString('base64'), true, (buf) => { result2 = buf; });
    assert.strictEqual(result1.toString(), 'aaaAAA');
    assert.strictEqual(result2.toString(), 'bbbBBB');
});

// ==========================================
// 3. 空值保护
// ==========================================
console.log('\n--- 3. 空值保护 ---\n');

test('无 requestId 不创建会话', () => {
    const pool = createAudioSessionPool();
    const result = pool.handleChunk(null, 'data', true);
    assert.strictEqual(result, null);
    assert.strictEqual(pool.sessions.size, 0);
});

test('无 chunk 数据不创建会话', () => {
    const pool = createAudioSessionPool();
    const result = pool.handleChunk('req-1', null, true);
    assert.strictEqual(result, null);
    assert.strictEqual(pool.sessions.size, 0);
});

// ==========================================
// 4. 会话清理
// ==========================================
console.log('\n--- 4. 会话清理 ---\n');

test('完成时会话从池中移除', () => {
    const pool = createAudioSessionPool();
    pool.handleChunk('req-1', Buffer.from('x').toString('base64'), false);
    assert.strictEqual(pool.sessions.size, 1, '分片中途池中有会话');
    pool.handleChunk('req-1', Buffer.from('y').toString('base64'), true);
    assert.strictEqual(pool.sessions.size, 0, '完成后会话移除');
});

test('单个分片也是合法完成', () => {
    const pool = createAudioSessionPool();
    let result = null;
    pool.handleChunk('req-1', Buffer.from('single').toString('base64'), true, (buf) => { result = buf; });
    assert.ok(result);
    assert.strictEqual(result.toString(), 'single');
    assert.strictEqual(pool.sessions.size, 0);
});

// ==========================================
// 结果
// ==========================================
console.log('\n=== 测试结果 ===\n');
console.log(`总计: ${testCount} 个测试`);
console.log(`通过: ${passCount} 个测试`);
console.log(`失败: ${testCount - passCount} 个测试`);

if (passCount === testCount) {
    console.log('\n✓ audioChunk 会话管理自测全部通过！');
} else {
    console.log('\n✗ 存在失败的自测');
    process.exit(1);
}
