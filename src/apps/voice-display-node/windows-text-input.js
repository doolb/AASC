'use strict';

const { spawn } = require('node:child_process');

const WINDOWS_HOTKEY_LABEL = 'Ctrl+Alt+Space';
const POWERSHELL_OPERATION_TIMEOUT_MS = 5000;
const POWERSHELL_HOTKEY_START_TIMEOUT_MS = 5000;

// PowerShell 使用 UTF-16LE 接收 -EncodedCommand；统一编码可以避免中文和引号被命令行再次转义。
function encodePowerShellCommand(command) {
    return Buffer.from(command, 'utf16le').toString('base64');
}

function escapePowerShellJson(value) {
    return JSON.stringify(value).replace(/'/g, "''");
}

function createWin32InputTypeDefinition() {
    return `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class AascWindowsInputNative {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint numberOfInputs, INPUT[] inputs, int size);

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT {
        public uint type;
        public INPUTUNION input;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct INPUTUNION {
        // INPUT 的联合体大小由最大的 MOUSEINPUT 决定，不能只声明 KEYBDINPUT。
        [FieldOffset(0)] public MOUSEINPUT mouse;
        [FieldOffset(0)] public KEYBDINPUT keyboard;
        [FieldOffset(0)] public HARDWAREINPUT hardware;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint flags;
        public uint time;
        public IntPtr extraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT {
        public ushort virtualKey;
        public ushort scanCode;
        public uint flags;
        public uint time;
        public IntPtr extraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct HARDWAREINPUT {
        public uint message;
        public ushort parameterLow;
        public ushort parameterHigh;
    }

    private const uint INPUT_KEYBOARD = 1;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_UNICODE = 0x0004;
    private const ushort VK_CONTROL = 0x11;
    private const ushort VK_V = 0x56;
    private const ushort VK_RETURN = 0x0D;
    private const ushort VK_BACK = 0x08;

    private static void EnsureInputSent(uint expectedCount, INPUT[] inputs, string action) {
        uint sentCount = SendInput(expectedCount, inputs, Marshal.SizeOf(typeof(INPUT)));
        if (sentCount != expectedCount) {
            int errorCode = Marshal.GetLastWin32Error();
            throw new InvalidOperationException(action + "，Win32错误码: " + errorCode);
        }
    }

    private static void SendVirtualKey(ushort virtualKey) {
        INPUT[] inputs = new INPUT[2];
        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].input.keyboard.virtualKey = virtualKey;
        inputs[1].type = INPUT_KEYBOARD;
        inputs[1].input.keyboard.virtualKey = virtualKey;
        inputs[1].input.keyboard.flags = KEYEVENTF_KEYUP;
        EnsureInputSent((uint)inputs.Length, inputs, "SendInput 虚拟按键失败");
    }

    public static void Paste() {
        INPUT[] inputs = new INPUT[4];
        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].input.keyboard.virtualKey = VK_CONTROL;
        inputs[1].type = INPUT_KEYBOARD;
        inputs[1].input.keyboard.virtualKey = VK_V;
        inputs[2].type = INPUT_KEYBOARD;
        inputs[2].input.keyboard.virtualKey = VK_V;
        inputs[2].input.keyboard.flags = KEYEVENTF_KEYUP;
        inputs[3].type = INPUT_KEYBOARD;
        inputs[3].input.keyboard.virtualKey = VK_CONTROL;
        inputs[3].input.keyboard.flags = KEYEVENTF_KEYUP;
        EnsureInputSent((uint)inputs.Length, inputs, "SendInput 粘贴失败");
    }

    public static void SendEnter() {
        SendVirtualKey(VK_RETURN);
    }

    public static void SendBackspace(int count) {
        for (int index = 0; index < count; index++) {
            SendVirtualKey(VK_BACK);
        }
    }
}
'@
`;
}

function createHotkeyTypeDefinition() {
    return `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class AascWindowsHotkeyNative {
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr windowHandle, int id, uint modifiers, uint virtualKey);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(IntPtr windowHandle, int id);

    [DllImport("user32.dll")]
    private static extern int GetMessage(out MSG message, IntPtr windowHandle, uint minimum, uint maximum);

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG {
        public IntPtr windowHandle;
        public uint message;
        public UIntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int pointX;
        public int pointY;
    }

    private const uint MOD_ALT = 0x0001;
    private const uint MOD_CONTROL = 0x0002;
    private const uint VK_SPACE = 0x20;
    private const uint WM_HOTKEY = 0x0312;
    private const int HOTKEY_ID = 1;

    public static void Run() {
        if (!RegisterHotKey(IntPtr.Zero, HOTKEY_ID, MOD_CONTROL | MOD_ALT, VK_SPACE)) {
            Console.WriteLine("error:register");
            Console.Out.Flush();
            return;
        }

        Console.WriteLine("ready");
        Console.Out.Flush();

        MSG message;
        while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0) {
            if (message.message == WM_HOTKEY && message.wParam.ToUInt32() == HOTKEY_ID) {
                Console.WriteLine("toggle");
                Console.Out.Flush();
            }
        }

        UnregisterHotKey(IntPtr.Zero, HOTKEY_ID);
    }
}
'@
[AascWindowsHotkeyNative]::Run()
`;
}

function createClipboardHelpers() {
    return `
Add-Type -AssemblyName System.Windows.Forms
`;
}

function createOperationScript(operation) {
    const payload = escapePowerShellJson(operation);
    return `
$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom
${createWin32InputTypeDefinition()}
${createClipboardHelpers()}
$operation = '${payload}' | ConvertFrom-Json

function Get-WindowId {
    return [Int64][AascWindowsInputNative]::GetForegroundWindow().ToInt64()
}

function Write-Result($value) {
    $value | ConvertTo-Json -Compress
}

try {
    $currentWindowId = Get-WindowId
    if ($currentWindowId -eq 0) {
        throw '没有可用的 Windows 前台窗口'
    }

    if ($operation.type -eq 'insertText') {
        $oldClipboard = $null
        $hasOldClipboard = [System.Windows.Forms.Clipboard]::ContainsText()
        if ($hasOldClipboard) {
            $oldClipboard = [System.Windows.Forms.Clipboard]::GetText()
        }

        [System.Windows.Forms.Clipboard]::SetText([string]$operation.text)
        [AascWindowsInputNative]::Paste()
        Start-Sleep -Milliseconds 60

        if ($hasOldClipboard) {
            [System.Windows.Forms.Clipboard]::SetText($oldClipboard)
        } else {
            [System.Windows.Forms.Clipboard]::Clear()
        }

        Write-Result @{ success = $true; windowId = $currentWindowId }
    } elseif ($operation.type -eq 'backspaceText') {
        if ($currentWindowId -ne [Int64]$operation.windowId) {
            Write-Result @{ success = $false; reason = 'window-changed'; windowId = $currentWindowId }
        } else {
            [AascWindowsInputNative]::SendBackspace([Int32]$operation.count)
            Write-Result @{ success = $true; windowId = $currentWindowId }
        }
    } elseif ($operation.type -eq 'sendEnter') {
        if ($currentWindowId -ne [Int64]$operation.windowId) {
            Write-Result @{ success = $false; reason = 'window-changed'; windowId = $currentWindowId }
        } else {
            [AascWindowsInputNative]::SendEnter()
            Write-Result @{ success = $true; windowId = $currentWindowId }
        }
    } else {
        throw ('未知 Windows 输入操作: ' + $operation.type)
    }
} catch {
    Write-Result @{ success = $false; error = $_.Exception.Message }
    exit 1
}
`;
}

function runPowerShellOperation(operation, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-STA',
            '-WindowStyle',
            'Hidden',
            '-EncodedCommand',
            encodePowerShellCommand(createOperationScript(operation))
        ], {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        const children = options.children;
        if (children) children.add(child);

        let stdout = '';
        let stderr = '';
        let settled = false;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (children) children.delete(child);
            callback(value);
        };
        const timeout = setTimeout(() => {
            child.kill();
            finish(reject, new Error('Windows 输入操作超时'));
        }, POWERSHELL_OPERATION_TIMEOUT_MS);

        child.stdout.on('data', data => {
            stdout += data.toString();
        });
        child.stderr.on('data', data => {
            stderr += data.toString();
        });
        child.on('error', error => finish(reject, error));
        child.on('close', code => {
            const line = stdout.trim().split(/\r?\n/u).filter(Boolean).pop();
            if (!line) {
                finish(reject, new Error(stderr.trim() || `PowerShell 退出码 ${code}`));
                return;
            }
            try {
                const result = JSON.parse(line);
                if (code !== 0 && result.success !== true) {
                    finish(reject, new Error(result.error || stderr.trim() || 'Windows 输入操作失败'));
                    return;
                }
                finish(resolve, result);
            } catch (error) {
                finish(reject, new Error(`Windows 输入结果解析失败: ${error.message}`));
            }
        });
    });
}

function countTextUnits(text) {
    const value = String(text || '');
    if (!value) return 0;
    if (typeof Intl.Segmenter === 'function') {
        const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
        return Array.from(segmenter.segment(value)).length;
    }
    return Array.from(value).length;
}

function normalizeTextInputCommand(text) {
    return String(text || '')
        .trim()
        .replace(/[。！？!?，,、；;：:]+$/u, '');
}

function isTextInputCommand(text, command) {
    return normalizeTextInputCommand(text) === command;
}

class WindowsTextInputInjector {
    constructor(options = {}) {
        this.platform = options.platform || process.platform;
        this.children = new Set();
        this.closed = false;
        this.operationQueue = Promise.resolve();
        this.runOperation = options.runOperation || (operation => runPowerShellOperation(operation, {
            children: this.children
        }));
    }

    isAvailable() {
        return this.platform === 'win32';
    }

    _ensureAvailable() {
        if (!this.isAvailable()) {
            throw new Error('Windows 系统输入注入仅支持 Windows');
        }
        if (this.closed) {
            throw new Error('Windows 输入注入器已关闭');
        }
    }

    _enqueue(operation) {
        const task = this.operationQueue.then(async () => {
            this._ensureAvailable();
            return await operation();
        });
        this.operationQueue = task.catch(() => {});
        return task;
    }

    insertText(text) {
        const value = String(text || '');
        if (!value) return Promise.resolve({ success: false, reason: 'empty-text' });
        return this._enqueue(() => this.runOperation({ type: 'insertText', text: value }));
    }

    backspaceText(record) {
        const text = String(record?.text || '');
        const windowId = record?.windowId;
        return this._enqueue(() => this.runOperation({
            type: 'backspaceText',
            text,
            windowId,
            count: countTextUnits(text)
        }));
    }

    sendEnter(windowId) {
        return this._enqueue(() => this.runOperation({ type: 'sendEnter', windowId }));
    }

    close() {
        this.closed = true;
        for (const child of this.children) {
            try {
                child.kill();
            } catch (error) {
                // 子进程已退出时无需重复处理。
            }
        }
        this.children.clear();
    }
}

class WindowsGlobalHotkey {
    constructor(options = {}) {
        this.platform = options.platform || process.platform;
        this.onToggle = typeof options.onToggle === 'function' ? options.onToggle : () => {};
        this.spawnProcess = options.spawnProcess || spawn;
        this.child = null;
        this.closed = false;
    }

    isAvailable() {
        return this.platform === 'win32';
    }

    start() {
        if (!this.isAvailable()) return Promise.resolve(false);
        if (this.child) return Promise.resolve(true);

        return new Promise((resolve, reject) => {
            let settled = false;
            const child = this.spawnProcess('powershell.exe', [
                '-NoLogo',
                '-NoProfile',
                '-NonInteractive',
                '-WindowStyle',
                'Hidden',
                '-EncodedCommand',
                encodePowerShellCommand(createHotkeyTypeDefinition())
            ], {
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe']
            });
            this.child = child;

            let stdout = '';
            let stderr = '';
            const settle = (callback, value) => {
                if (settled) return;
                settled = true;
                clearTimeout(startTimeout);
                callback(value);
            };
            const startTimeout = setTimeout(() => {
                try {
                    child.kill();
                } catch (error) {
                    // 子进程已退出时无需重复处理。
                }
                settle(reject, new Error(`注册全局快捷键超时（${POWERSHELL_HOTKEY_START_TIMEOUT_MS}ms）`));
            }, POWERSHELL_HOTKEY_START_TIMEOUT_MS);

            child.stdout.on('data', data => {
                stdout += data.toString();
                const lines = stdout.split(/\r?\n/u);
                stdout = lines.pop() || '';
                for (const line of lines) {
                    if (line.trim() === 'ready') settle(resolve, true);
                    if (line.trim() === 'toggle') this.onToggle();
                    if (line.trim() === 'error:register') {
                        settle(reject, new Error(`无法注册全局快捷键 ${WINDOWS_HOTKEY_LABEL}`));
                    }
                }
            });
            child.stderr.on('data', data => {
                stderr += data.toString();
            });
            child.on('error', error => {
                this.child = null;
                settle(reject, error);
            });
            child.on('close', code => {
                if (this.child === child) this.child = null;
                if (!settled) {
                    if (this.closed) {
                        settle(resolve, false);
                    } else {
                        settle(reject, new Error(stderr.trim() || `全局快捷键进程退出码 ${code}`));
                    }
                }
            });
        });
    }

    close() {
        this.closed = true;
        if (!this.child) return;
        try {
            this.child.kill();
        } catch (error) {
            // 子进程已退出时无需重复处理。
        }
        this.child = null;
    }
}

module.exports = {
    WINDOWS_HOTKEY_LABEL,
    WindowsGlobalHotkey,
    WindowsTextInputInjector,
    countTextUnits,
    isTextInputCommand,
    normalizeTextInputCommand
};
