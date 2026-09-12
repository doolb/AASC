'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    WindowsTextInputInjector,
    countTextUnits
} = require('../src/apps/voice-display-node/windows-text-input');
const windowsInputSource = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../src/apps/voice-display-node/windows-text-input.js'),
    'utf8'
);

test('Windows 输入注入器在非 Windows 平台明确不可用', async () => {
    const injector = new WindowsTextInputInjector({ platform: 'linux' });

    assert.equal(injector.isAvailable(), false);
    await assert.rejects(
        injector.insertText('测试'),
        /仅支持 Windows/,
        '非 Windows 不应尝试执行系统注入'
    );
});

test('Windows 输入注入器按串行队列注入文本并返回目标窗口', async () => {
    const operations = [];
    const injector = new WindowsTextInputInjector({
        platform: 'win32',
        runOperation: async (operation) => {
            operations.push(operation);
            await new Promise(resolve => setTimeout(resolve, 5));
            return { success: true, windowId: 'window-1' };
        }
    });

    const [first, second] = await Promise.all([
        injector.insertText('你好'),
        injector.insertText('世界')
    ]);

    assert.deepEqual(
        operations.map(operation => operation.type),
        ['insertText', 'insertText'],
        '系统操作必须保持调用顺序'
    );
    assert.equal(first.windowId, 'window-1');
    assert.equal(second.windowId, 'window-1');
    assert.equal(operations[0].text, '你好');
    assert.equal(operations[1].text, '世界');
});

test('返回和发送必须携带最近一次注入的窗口标识', async () => {
    const operations = [];
    const injector = new WindowsTextInputInjector({
        platform: 'win32',
        runOperation: async (operation) => {
            operations.push(operation);
            return { success: true, windowId: operation.windowId || 'window-2' };
        }
    });
    const record = { text: '你好😀', windowId: 'window-2' };

    await injector.backspaceText(record);
    await injector.sendEnter(record.windowId);

    assert.deepEqual(operations, [
        {
            type: 'backspaceText',
            text: record.text,
            windowId: record.windowId,
            count: countTextUnits(record.text)
        },
        {
            type: 'sendEnter',
            windowId: record.windowId
        }
    ]);
});

test('返回字符数量按用户可见字符计算', () => {
    assert.equal(countTextUnits('你好'), 2);
    assert.equal(countTextUnits('你好😀'), 3);
    assert.equal(countTextUnits(''), 0);
});

test('Windows SendInput 使用完整原生 INPUT 联合体并以 UTF-8 输出诊断信息', () => {
    assert.match(windowsInputSource, /struct MOUSEINPUT/u, 'INPUT 联合体应包含原生最大鼠标成员');
    assert.match(windowsInputSource, /struct HARDWAREINPUT/u, 'INPUT 联合体应包含原生硬件成员');
    assert.match(windowsInputSource, /Marshal\.GetLastWin32Error\(\)/u, 'SendInput 失败应保留 Win32 错误码');
    assert.match(windowsInputSource, /Console\]::OutputEncoding/u, 'PowerShell 输出应固定为 UTF-8');
});
