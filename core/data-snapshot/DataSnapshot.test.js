const assert = require('assert');
const fs = require('fs');
const path = require('path');
const DataSnapshot = require('./DataSnapshot');
const JsonFile = require('./JsonFile');

const TEST_DIR = path.join(__dirname, '.test-temp');

function cleanup() {
    if (fs.existsSync(TEST_DIR)) {
        fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
}

function setup() {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
}

function teardown() {
    cleanup();
}

function test(name, fn) {
    try {
        fn();
        console.log(`  ✅ ${name}`);
        return true;
    } catch (err) {
        console.log(`  ❌ ${name}`);
        console.log(`     Error: ${err.message}`);
        return false;
    }
}

function runTests() {
    console.log('\n🧪 DataSnapshot 单元测试\n');

    let passed = 0;
    let failed = 0;

    setup();

    console.log('📦 DataSnapshot 基类测试');

    if (test('创建实例并加载默认值', () => {
        class TestConfig extends DataSnapshot {
            static defaults = {
                name: 'test',
                value: 123
            };
        }
        const config = new TestConfig(path.join(TEST_DIR, 'test1.json'));
        assert.strictEqual(config.name, 'test');
        assert.strictEqual(config.value, 123);
    })) passed++; else failed++;

    if (test('修改属性自动保存', () => {
        class TestConfig extends DataSnapshot {
            static defaults = { count: 0 };
        }
        const filePath = path.join(TEST_DIR, 'test2.json');
        const config = new TestConfig(filePath);
        config.count = 100;
        
        const loaded = JsonFile.read(filePath);
        assert.strictEqual(loaded.count, 100);
    })) passed++; else failed++;

    if (test('嵌套对象修改自动保存', () => {
        class TestConfig extends DataSnapshot {
            static defaults = {
                server: { port: 8080 }
            };
        }
        const filePath = path.join(TEST_DIR, 'test3.json');
        const config = new TestConfig(filePath);
        config.server.port = 9090;
        
        const loaded = JsonFile.read(filePath);
        assert.strictEqual(loaded.server.port, 9090);
    })) passed++; else failed++;

    if (test('删除属性自动保存', () => {
        class TestConfig extends DataSnapshot {
            static defaults = { a: 1, b: 2 };
        }
        const filePath = path.join(TEST_DIR, 'test4.json');
        const config = new TestConfig(filePath);
        delete config.b;
        
        const loaded = JsonFile.read(filePath);
        assert.strictEqual(loaded.a, 1);
        assert.strictEqual('b' in loaded, false);
    })) passed++; else failed++;

    if (test('批量操作', () => {
        class TestConfig extends DataSnapshot {
            static defaults = { a: 0, b: 0, c: 0 };
        }
        const filePath = path.join(TEST_DIR, 'test5.json');
        const config = new TestConfig(filePath);
        config.batch((data) => {
            data.a = 1;
            data.b = 2;
            data.c = 3;
        });
        
        const loaded = JsonFile.read(filePath);
        assert.strictEqual(loaded.a, 1);
        assert.strictEqual(loaded.b, 2);
        assert.strictEqual(loaded.c, 3);
    })) passed++; else failed++;

    if (test('从文件加载数据', () => {
        const filePath = path.join(TEST_DIR, 'test6.json');
        JsonFile.write(filePath, { existing: 'data' });
        
        class TestConfig extends DataSnapshot {
            static defaults = { existing: 'default', newKey: 'new' };
        }
        const config = new TestConfig(filePath);
        
        assert.strictEqual(config.existing, 'data');
        assert.strictEqual(config.newKey, 'new');
    })) passed++; else failed++;

    if (test('深度合并', () => {
        const filePath = path.join(TEST_DIR, 'test7.json');
        JsonFile.write(filePath, {
            server: { port: 9090, host: 'localhost' }
        });
        
        class TestConfig extends DataSnapshot {
            static defaults = {
                server: { port: 8080, timeout: 30000 },
                other: 'default'
            };
        }
        const config = new TestConfig(filePath);
        
        assert.strictEqual(config.server.port, 9090);
        assert.strictEqual(config.server.host, 'localhost');
        assert.strictEqual(config.server.timeout, 30000);
        assert.strictEqual(config.other, 'default');
    })) passed++; else failed++;

    console.log('\n📦 JsonFile 工具类测试');

    if (test('JsonFile.write 和 read', () => {
        const filePath = path.join(TEST_DIR, 'json1.json');
        JsonFile.write(filePath, { test: 'value' });
        const data = JsonFile.read(filePath);
        assert.deepStrictEqual(data, { test: 'value' });
    })) passed++; else failed++;

    if (test('JsonFile.exists', () => {
        const filePath = path.join(TEST_DIR, 'json2.json');
        assert.strictEqual(JsonFile.exists(filePath), false);
        JsonFile.write(filePath, {});
        assert.strictEqual(JsonFile.exists(filePath), true);
    })) passed++; else failed++;

    if (test('JsonFile.delete', () => {
        const filePath = path.join(TEST_DIR, 'json3.json');
        JsonFile.write(filePath, {});
        JsonFile.delete(filePath);
        assert.strictEqual(JsonFile.exists(filePath), false);
    })) passed++; else failed++;

    if (test('JsonFile.readOrDefault', () => {
        const filePath = path.join(TEST_DIR, 'json4.json');
        const data = JsonFile.readOrDefault(filePath, { default: true });
        assert.deepStrictEqual(data, { default: true });
        
        JsonFile.write(filePath, { loaded: true });
        const loaded = JsonFile.readOrDefault(filePath, { default: true });
        assert.deepStrictEqual(loaded, { loaded: true });
    })) passed++; else failed++;

    console.log('\n📦 DataSnapshot 绑定功能测试');

    if (test('绑定回调，修改属性触发通知', () => {
        class TestConfig extends DataSnapshot {
            static defaults = { count: 0 };
        }
        const config = new TestConfig(path.join(TEST_DIR, 'bind1.json'));
        let callCount = 0;
        
        config.bind(() => callCount++);
        
        assert.strictEqual(callCount, 1);
        
        config.count = 100;
        assert.strictEqual(callCount, 2);
    })) passed++; else failed++;

    if (test('解绑回调，不再触发通知', () => {
        class TestConfig extends DataSnapshot {
            static defaults = { count: 0 };
        }
        const config = new TestConfig(path.join(TEST_DIR, 'bind2.json'));
        let callCount = 0;
        
        const unbind = config.bind(() => callCount++);
        
        assert.strictEqual(callCount, 1);
        
        unbind();
        config.count = 100;
        assert.strictEqual(callCount, 1);
    })) passed++; else failed++;

    if (test('使用 key 绑定特定属性', () => {
        class TestConfig extends DataSnapshot {
            static defaults = { a: 1, b: 2 };
        }
        const config = new TestConfig(path.join(TEST_DIR, 'bind3.json'));
        let callCount = 0;
        
        config.bind('a', () => callCount++);
        
        assert.strictEqual(callCount, 1);
        
        config.a = 10;
        assert.strictEqual(callCount, 2);
    })) passed++; else failed++;

    if (test('绑定多个回调', () => {
        class TestConfig extends DataSnapshot {
            static defaults = { count: 0 };
        }
        const config = new TestConfig(path.join(TEST_DIR, 'bind4.json'));
        let count1 = 0;
        let count2 = 0;
        
        config.bind(() => count1++);
        config.bind(() => count2++);
        
        assert.strictEqual(count1, 1);
        assert.strictEqual(count2, 1);
        
        config.count = 100;
        assert.strictEqual(count1, 2);
        assert.strictEqual(count2, 2);
    })) passed++; else failed++;

    if (test('unbindAll 清除所有绑定', () => {
        class TestConfig extends DataSnapshot {
            static defaults = { count: 0 };
        }
        const config = new TestConfig(path.join(TEST_DIR, 'bind5.json'));
        let callCount = 0;
        
        config.bind(() => callCount++);
        config.bind('key', () => callCount++);
        
        assert.strictEqual(callCount, 2);
        
        config.unbindAll();
        config.count = 100;
        assert.strictEqual(callCount, 2);
    })) passed++; else failed++;

    if (test('嵌套对象修改触发通知', () => {
        class TestConfig extends DataSnapshot {
            static defaults = { server: { port: 8080 } };
        }
        const config = new TestConfig(path.join(TEST_DIR, 'bind6.json'));
        let callCount = 0;
        
        config.bind(() => callCount++);
        
        assert.strictEqual(callCount, 1);
        
        config.server.port = 9090;
        assert.strictEqual(callCount, 2);
    })) passed++; else failed++;

    teardown();

    console.log(`\n📊 测试结果: ${passed} 通过, ${failed} 失败\n`);

    return failed === 0;
}

module.exports = { runTests };

if (require.main === module) {
    runTests();
}
