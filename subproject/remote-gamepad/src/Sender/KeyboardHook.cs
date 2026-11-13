using System.ComponentModel;
using System.Runtime.InteropServices;

internal sealed class KeyboardHook : IDisposable
{
    private readonly KeyboardRouter router;
    private readonly bool allowInjectedForTests;
    private readonly HookProc callback;
    private readonly HookProc mouseCallback;
    private readonly TaskCompletionSource<bool> ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly Thread thread;
    private uint threadId;
    private IntPtr hook;
    private IntPtr mouseHook;

    public KeyboardHook(KeyboardRouter router, bool allowInjectedForTests = false)
    {
        this.router = router;
        this.allowInjectedForTests = allowInjectedForTests;
        callback = OnKey;
        mouseCallback = OnMouse;
        thread = new Thread(Run) { IsBackground = true, Name = "keyboard and mouse hooks" };
    }
    public Task StartAsync() { thread.Start(); return ready.Task; }
    private void Run()
    {
        threadId = GetCurrentThreadId();
        SetThreadDpiAwarenessContext(new IntPtr(-4));
        hook = SetWindowsHookEx(13, callback, GetModuleHandle(null), 0);
        if (hook == IntPtr.Zero) { ready.TrySetException(new Win32Exception(Marshal.GetLastWin32Error())); return; }
        mouseHook = SetWindowsHookEx(14, mouseCallback, GetModuleHandle(null), 0);
        if (mouseHook == IntPtr.Zero)
        {
            int error = Marshal.GetLastWin32Error();
            UnhookWindowsHookEx(hook);
            ready.TrySetException(new Win32Exception(error));
            return;
        }
        RawMouseInput? rawMouse = null;
        try
        {
            try
            {
                rawMouse = new RawMouseInput(router);
                rawMouse.Start();
                router.SetRelativeAvailable();
            }
            catch (Exception ex)
            {
                rawMouse?.Dispose(); rawMouse = null;
                router.SetRelativeUnavailable();
                if (router.RelativeMouse) throw;
                SenderLog.WriteLine($"原始鼠标输入不可用，增量模式已禁用: {ex.Message}");
            }
            // Ensure the thread's message queue exists before signalling readiness.
            PeekMessage(out _, IntPtr.Zero, 0, 0, 0);
            ready.TrySetResult(true);
            while (GetMessage(out var message, IntPtr.Zero, 0, 0) > 0) { TranslateMessage(ref message); DispatchMessage(ref message); }
        }
        catch (Exception ex) { ready.TrySetException(ex); }
        finally { rawMouse?.Dispose(); UnhookWindowsHookEx(mouseHook); UnhookWindowsHookEx(hook); }
    }
    private IntPtr OnMouse(int code, IntPtr message, IntPtr data)
    {
        if (code >= 0)
        {
            var mouse = Marshal.PtrToStructure<MouseHookData>(data);
            if ((mouse.Flags & 1) == 0 || allowInjectedForTests)
            {
                int msg = message.ToInt32();
                if (msg == 0x200)
                {
                    if (router.RelativeCaptureEnabled) return new IntPtr(1);
                    SendPosition(mouse.Point);
                }
                else if (msg is 0x20A or 0x20E)
                {
                    SendPosition(mouse.Point);
                    if (router.MouseWheel(unchecked((short)(mouse.MouseData >> 16)), msg == 0x20E)) return new IntPtr(1);
                }
                else
                {
                    byte button = msg switch
                    {
                        0x201 or 0x202 => 1,
                        0x204 or 0x205 => 2,
                        0x207 or 0x208 => 3,
                        0x20B or 0x20C when (mouse.MouseData >> 16) == 1 => 4,
                        0x20B or 0x20C when (mouse.MouseData >> 16) == 2 => 5,
                        _ => 0
                    };
                    if (button != 0)
                    {
                        SendPosition(mouse.Point);
                        if (router.MouseButton(button, msg is 0x201 or 0x204 or 0x207 or 0x20B)) return new IntPtr(1);
                    }
                }
            }
        }
        return CallNextHookEx(mouseHook, code, message, data);
    }
    private void SendPosition(Point point)
    {
        if (router.RelativeMouse) return;
        int left = GetSystemMetrics(76), top = GetSystemMetrics(77);
        int width = GetSystemMetrics(78), height = GetSystemMetrics(79);
        if (width <= 1 || height <= 1) return;
        ushort x = (ushort)Math.Clamp(((long)point.X - left) * 65535 / (width - 1), 0, 65535);
        ushort y = (ushort)Math.Clamp(((long)point.Y - top) * 65535 / (height - 1), 0, 65535);
        router.MouseMove(x, y);
    }
    private IntPtr OnKey(int code, IntPtr message, IntPtr data)
    {
        if (code >= 0)
        {
            var key = Marshal.PtrToStructure<HookData>(data);
            var msg = message.ToInt32();
            if ((key.Flags & 0x10) == 0 && key.VirtualKey is > 0 and <= 255 && key.ScanCode <= 255 &&
                msg is 0x100 or 0x101 or 0x104 or 0x105 &&
                router.Process((byte)key.VirtualKey, (byte)key.ScanCode, (byte)(key.Flags & 1), msg is 0x100 or 0x104))
                return new IntPtr(1);
        }
        return CallNextHookEx(hook, code, message, data);
    }
    public void Dispose()
    {
        if (threadId != 0 && thread.IsAlive) { PostThreadMessage(threadId, 0x0012, UIntPtr.Zero, IntPtr.Zero); thread.Join(); }
    }
    private delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)] private struct HookData { public uint VirtualKey, ScanCode, Flags, Time; public UIntPtr ExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] private struct MouseHookData { public Point Point; public uint MouseData, Flags, Time; public UIntPtr ExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct Message { public IntPtr Hwnd; public uint Value; public UIntPtr WParam; public IntPtr LParam; public uint Time; public Point Pt; public uint Private; }
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr module, uint threadId);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")] private static extern int GetMessage(out Message message, IntPtr hwnd, uint min, uint max);
    [DllImport("user32.dll")] private static extern bool PeekMessage(out Message message, IntPtr hwnd, uint min, uint max, uint remove);
    [DllImport("user32.dll")] private static extern bool TranslateMessage(ref Message message);
    [DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref Message message);
    [DllImport("user32.dll")] private static extern bool PostThreadMessage(uint id, uint message, UIntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpiContext);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string? name);
}
