using System.Diagnostics;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Threading.Channels;
using RemoteGamepad;

// Exercise the toggle and local/remote key-up balancing without a real keyboard hook.
var channel = Channel.CreateBounded<KeyboardPacket>(512);
if (TerminalDashboard.ProgressBar(0, 10) != "[----------]" ||
    TerminalDashboard.ProgressBar(1, 10) != "[#---------]" ||
    TerminalDashboard.ProgressBar(50, 10) != "[#####-----]" ||
    TerminalDashboard.ProgressBar(100, 10) != "[##########]" ||
    TerminalDashboard.ProgressBar(null, 4) != "[????]" ||
    TerminalDashboard.ProgressBar(double.NaN, 4) != "[????]" ||
    TerminalDashboard.ProgressBar(120, 4) != "[####]" ||
    TerminalDashboard.UsagePercent(1, 0) != null || TerminalDashboard.UsagePercent(null, 10) != null ||
    TerminalDashboard.UsagePercent(2, 4) != 50)
    throw new Exception("progress bars must show correct values and distinguish unknown totals");
Console.WriteLine("PASS: progress bar values and unavailable totals");
var router = new KeyboardRouter();
router.Attach(channel.Writer);
void Check(bool condition, string description) { if (!condition) throw new Exception(description); }
void Packet(byte operation, byte vk = 0) { Check(channel.Reader.TryRead(out var packet) && packet.Operation == operation && packet.VirtualKey == vk, $"expected packet {operation}/{vk}"); }
Check(!router.TrySetMouseMode(true, out _), "relative mode unavailable before raw input starts");
router.SetRelativeAvailable();
Check(router.TrySetMouseMode(true, out _) && router.RelativeMouse, "switch to relative without reconnect");
Check(router.TrySetMouseMode(false, out _) && !router.RelativeMouse, "switch back to absolute without reconnect");
Check(!router.Process(0xA2, 0x1D, 0, true), "local Ctrl down");
Check(router.Process(0x1B, 1, 0, true), "enable hotkey down");
Check(router.Process(0x1B, 1, 0, false), "enable hotkey up");
Check(!router.TrySetMouseMode(true, out _) && !router.RelativeMouse, "must pause forwarding before switching mode");
Check(!router.Process(0xA2, 0x1D, 0, false), "local Ctrl up");
Check(router.Process(0x41, 0x1E, 0, true), "remote A down"); Packet(KeyboardPacket.Down, 0x41);
router.MouseMove(12345, 34567);
Check(channel.Reader.TryRead(out var move) && move.Operation == KeyboardPacket.MouseMove && move.X == 12345 && move.Y == 34567, "mouse position");
Check(router.MouseButton(3, true), "remote middle mouse down"); Packet(KeyboardPacket.MouseDown, 3);
Check(router.MouseWheel(-120, false), "remote wheel");
Check(channel.Reader.TryRead(out var wheel) && wheel.Operation == KeyboardPacket.MouseWheel && unchecked((short)wheel.X) == -120, "wheel direction");
Check(router.Process(0xA2, 0x1D, 0, true), "remote Ctrl down"); Packet(KeyboardPacket.Down, 0xA2);
Check(router.Process(0x1B, 1, 0, true), "disable hotkey down"); Packet(KeyboardPacket.ReleaseAll);
Check(router.Process(0x1B, 1, 0, false), "disable hotkey up");
Check(router.Process(0xA2, 0x1D, 0, false), "swallow previously remote Ctrl up");
Check(router.Process(0x41, 0x1E, 0, false), "swallow previously remote A up");
Check(router.MouseButton(3, false), "swallow previously remote mouse up");
Check(!router.MouseButton(3, true), "local mouse down after disabling");
Check(!router.MouseButton(3, false), "local mouse up after disabling");
Check(!router.Process(0x42, 0x30, 0, true), "local B down after disabling");
Check(!router.Process(0x42, 0x30, 0, false), "local B up after disabling");
Check(!channel.Reader.TryRead(out _), "unexpected key after disabling");
Check(!router.Process(0xA2, 0x1D, 0, true), "local Ctrl down before reconnect test");
Check(router.Process(0x1B, 1, 0, true), "enable before reconnect test");
Check(router.Process(0x1B, 1, 0, false), "enable hotkey up before reconnect test");
Check(!router.Process(0xA2, 0x1D, 0, false), "local Ctrl up before reconnect test");
Check(router.Process(0x41, 0x1E, 0, true), "remote A before disconnect"); Packet(KeyboardPacket.Down, 0x41);
router.Detach();
Check(router.Process(0x41, 0x1E, 0, false), "swallow remote key up after disconnect");
router.Attach(channel.Writer);
Check(!router.Process(0x42, 0x30, 0, true), "reconnect must not auto-enable");
Check(!router.Process(0x42, 0x30, 0, false), "local key up after reconnect");
router.Detach();
Console.WriteLine("PASS: shared toggle, keyboard/mouse routing and local release balancing");

// Exercise the actual Terminal.Gui button click bindings using its in-memory driver.
Terminal.Gui.Application.Init(new Terminal.Gui.FakeDriver());
try
{
    var uiRouter = new KeyboardRouter();
    uiRouter.SetRelativeAvailable();
    var window = new Terminal.Gui.Window("test");
    var absoluteButton = new Terminal.Gui.Button("absolute") { X = 1, Y = 1 };
    var relativeButton = new Terminal.Gui.Button("relative") { X = 20, Y = 1 };
    TerminalDashboard.BindModeButtons(absoluteButton, relativeButton, uiRouter, _ => { });
    window.Add(absoluteButton, relativeButton);
    var runState = Terminal.Gui.Application.Begin(window);
    try
    {
        relativeButton.MouseEvent(new Terminal.Gui.MouseEvent { X = 0, Y = 0, Flags = Terminal.Gui.MouseFlags.Button1Clicked });
        Check(uiRouter.RelativeMouse, "click switches to relative mode");
        absoluteButton.MouseEvent(new Terminal.Gui.MouseEvent { X = 0, Y = 0, Flags = Terminal.Gui.MouseFlags.Button1Clicked });
        Check(!uiRouter.RelativeMouse, "click switches to absolute mode");
    }
    finally { Terminal.Gui.Application.End(runState); }
}
finally { Terminal.Gui.Application.Shutdown(); }
Console.WriteLine("PASS: Terminal.Gui mouse clicks switch modes");
if (args.Contains("--ui-only")) return;

// Allow injected events only in this test instance to exercise the real Windows hook.
var hookRouter = new KeyboardRouter();
var hookFrames = Channel.CreateBounded<KeyboardPacket>(512);
hookRouter.Attach(hookFrames.Writer);
hookRouter.Process(0xA2, 0x1D, 0, true);
hookRouter.Process(0x1B, 1, 0, true);
hookRouter.Process(0x1B, 1, 0, false);
hookRouter.Process(0xA2, 0x1D, 0, false);
Native.GetCursorPos(out var hookOriginalCursor);
using (var hook = new KeyboardHook(hookRouter, allowInjectedForTests: true))
{
    try
    {
        await hook.StartAsync();
        Native.mouse_event(0x0001, 8, 4, 0, UIntPtr.Zero);
        using var hookTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        var observed = await hookFrames.Reader.ReadAsync(hookTimeout.Token);
        Check(observed.Operation == KeyboardPacket.MouseMove, "Windows mouse hook movement");
        Console.WriteLine("PASS: Windows mouse hook forwards a movement");
    }
    finally { hookRouter.Detach(); Native.SetCursorPos(hookOriginalCursor.X, hookOriginalCursor.Y); }
}

var relativeRouter = new KeyboardRouter(relativeMouse: true);
var relativeFrames = Channel.CreateBounded<KeyboardPacket>(512);
relativeRouter.Attach(relativeFrames.Writer);
using (var relativeHook = new KeyboardHook(relativeRouter))
{
    await relativeHook.StartAsync();
    relativeRouter.Process(0xA2, 0x1D, 0, true);
    relativeRouter.Process(0x1B, 1, 0, true);
    relativeRouter.Process(0x1B, 1, 0, false);
    relativeRouter.Process(0xA2, 0x1D, 0, false);
    Check(relativeRouter.RelativeCaptureEnabled, "relative capture enabled");
    relativeRouter.MouseMove(1200, 3200);
    Check(!relativeFrames.Reader.TryRead(out _), "relative mode must not send absolute coordinates");
    relativeRouter.MouseMoveRelative(-30, 45);
    Check(relativeFrames.Reader.TryRead(out var delta) && delta.Operation == KeyboardPacket.MouseRelative &&
        unchecked((short)delta.X) == -30 && unchecked((short)delta.Y) == 45, "relative signed deltas");
    relativeRouter.MouseMoveRelative(40000, -40000);
    Check(relativeFrames.Reader.TryRead(out var first) && relativeFrames.Reader.TryRead(out var second) &&
        unchecked((short)first.X) + unchecked((short)second.X) == 40000 &&
        unchecked((short)first.Y) + unchecked((short)second.Y) == -40000, "large relative movement splitting");
    relativeRouter.Detach();
    Check(!relativeRouter.RelativeCaptureEnabled, "relative capture disabled on disconnect");
}
Console.WriteLine("PASS: raw-input registration, relative routing and delta splitting");
int rawHeaderSize = IntPtr.Size == 8 ? 24 : 16;
var rawReport = Marshal.AllocHGlobal(rawHeaderSize + 24);
try
{
    for (int i = 0; i < rawHeaderSize + 24; i++) Marshal.WriteByte(rawReport, i, 0);
    Marshal.WriteInt32(rawReport, rawHeaderSize + 12, -42);
    Marshal.WriteInt32(rawReport, rawHeaderSize + 16, 77);
    Check(RawMouseInput.TryReadRelativeReport(rawReport, rawHeaderSize + 24, out int dx, out int dy) && dx == -42 && dy == 77, "raw-input delta decoding");
    Marshal.WriteInt16(rawReport, rawHeaderSize, 1);
    Check(!RawMouseInput.TryReadRelativeReport(rawReport, rawHeaderSize + 24, out _, out _), "absolute raw device is not a relative delta");
    Check(!RawMouseInput.TryReadRelativeReport(rawReport, rawHeaderSize + 19, out _, out _), "short raw report");
}
finally { Marshal.FreeHGlobal(rawReport); }
Console.WriteLine("PASS: raw mouse data decoding and absolute-device rejection");

if (args.Length != 2) throw new ArgumentException("Arguments: dotnet executable, subproject root");
var info = new ProcessStartInfo(args[0]) { UseShellExecute = false };
info.ArgumentList.Add(Path.Combine(Path.GetFullPath(args[1]), "src/Server/bin/Debug/net6.0/Server.dll"));
info.ArgumentList.Add("127.0.0.1");
info.ArgumentList.Add("29690");
using var server = Process.Start(info) ?? throw new Exception("Failed to start server");
Native.SetThreadDpiAwarenessContext(new IntPtr(-4));
Native.GetCursorPos(out var originalCursor);
try
{
    using var client = new TcpClient();
    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
    while (true)
    {
        try { await client.ConnectAsync("127.0.0.1", 29690, timeout.Token); break; }
        catch (SocketException) { await Task.Delay(100, timeout.Token); }
    }
    using var stream = client.GetStream();
    await stream.WriteAsync("VGK3"u8.ToArray(), timeout.Token);
    var ack = new byte[1];
    await stream.ReadFrameExactlyAsync(ack, timeout.Token);
    Check(ack[0] == 1, "keyboard handshake");
    using var heartbeatStop = new CancellationTokenSource();
    using var writeLock = new SemaphoreSlim(1, 1);
    async Task Send(KeyboardPacket packet, CancellationToken cancellation)
    {
        await writeLock.WaitAsync(cancellation);
        try { await stream.WriteAsync(packet.Encode(), cancellation); }
        finally { writeLock.Release(); }
    }
    var heartbeatTask = Task.Run(async () =>
    {
        try
        {
            while (true)
            {
                await Send(new KeyboardPacket(KeyboardPacket.Heartbeat, 0, 0, 0), heartbeatStop.Token);
                await Task.Delay(200, heartbeatStop.Token);
            }
        }
        catch (OperationCanceledException) when (heartbeatStop.IsCancellationRequested) { }
    });
    Native.SetThreadDpiAwarenessContext(new IntPtr(-4));
    Native.GetCursorPos(out var targetCursor);
    targetCursor.X -= 8;
    int left = Native.GetSystemMetrics(76), top = Native.GetSystemMetrics(77);
    int width = Native.GetSystemMetrics(78), height = Native.GetSystemMetrics(79);
    ushort targetX = (ushort)Math.Clamp((long)(targetCursor.X - left) * 65535 / (width - 1), 0, 65535);
    ushort targetY = (ushort)Math.Clamp((long)(targetCursor.Y - top) * 65535 / (height - 1), 0, 65535);
    using var observer = new MouseObserver();
    await observer.Start();
    await Send(new KeyboardPacket(KeyboardPacket.MouseMove, 0, 0, 0, targetX, targetY), timeout.Token);
    Native.Point observedCursor = default;
    int expectedX = 0, expectedY = 0;
    try { await Until(() =>
    {
        observedCursor = observer.LastPosition;
        expectedX = targetCursor.X;
        expectedY = targetCursor.Y;
        return Math.Abs(observedCursor.X - expectedX) <= 3 && Math.Abs(observedCursor.Y - expectedY) <= 3;
    }, "remote mouse move"); }
    catch (Exception ex) { throw new Exception($"{ex.Message}: actual ({observedCursor.X}, {observedCursor.Y}), expected ({expectedX}, {expectedY})", ex); }
    var beforeRelativeMove = observer.MovementCount;
    await Send(new KeyboardPacket(KeyboardPacket.MouseRelative, 0, 0, 0, 15, unchecked((ushort)(short)-7)), timeout.Token);
    await Until(() => observer.MovementCount > beforeRelativeMove, "relative mouse injection");
    await Send(new KeyboardPacket(KeyboardPacket.MouseWheel, 0, 0, 0, unchecked((ushort)(short)-120)), timeout.Token);
    await Until(() => observer.VerticalWheel == -120, "vertical wheel");
    await Send(new KeyboardPacket(KeyboardPacket.MouseHorizontalWheel, 0, 0, 0, 120), timeout.Token);
    await Until(() => observer.HorizontalWheel == 120, "horizontal wheel");
    await Send(new KeyboardPacket(KeyboardPacket.MouseDown, 3, 0, 0), timeout.Token);
    await Until(() => (Native.GetAsyncKeyState(0x04) & 0x8000) != 0, "remote middle button down");
    await Send(new KeyboardPacket(KeyboardPacket.Down, 0x87, 0, 0), timeout.Token); // F24
    await Until(() => (Native.GetAsyncKeyState(0x87) & 0x8000) != 0, "remote key down");
    await Send(new KeyboardPacket(KeyboardPacket.ReleaseAll, 0, 0, 0), timeout.Token);
    await Until(() => (Native.GetAsyncKeyState(0x87) & 0x8000) == 0, "release-all");
    await Until(() => (Native.GetAsyncKeyState(0x04) & 0x8000) == 0, "release-all mouse button");
    await Send(new KeyboardPacket(KeyboardPacket.MouseDown, 3, 0, 0), timeout.Token);
    await Until(() => (Native.GetAsyncKeyState(0x04) & 0x8000) != 0, "remote mouse down before timeout");
    await Send(new KeyboardPacket(KeyboardPacket.Down, 0x87, 0, 0), timeout.Token);
    await Until(() => (Native.GetAsyncKeyState(0x87) & 0x8000) != 0, "remote key down before disconnect");
    heartbeatStop.Cancel();
    await heartbeatTask;
    await Until(() => (Native.GetAsyncKeyState(0x87) & 0x8000) == 0, "release on heartbeat timeout");
    await Until(() => (Native.GetAsyncKeyState(0x04) & 0x8000) == 0, "mouse release on heartbeat timeout");
    client.Close();
    Console.WriteLine("PASS: network keyboard/mouse injection, release-all and timeout reset");
}
finally
{
    Native.keybd_event(0x87, 0, 2, UIntPtr.Zero);
    Native.mouse_event(0x0040, 0, 0, 0, UIntPtr.Zero);
    Native.SetCursorPos(originalCursor.X, originalCursor.Y);
    if (!server.HasExited) { server.Kill(true); await server.WaitForExitAsync(); }
}
static async Task Until(Func<bool> condition, string name)
{
    for (int i = 0; i < 200; i++) { if (condition()) return; await Task.Delay(20); }
    throw new Exception("Timed out: " + name);
}
static class Native
{
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int x, int y, uint data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
}

sealed class MouseObserver : IDisposable
{
    private readonly HookProc callback;
    private readonly Thread thread;
    private readonly TaskCompletionSource<bool> ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private uint threadId;
    private IntPtr handle;
    private long lastPosition = long.MaxValue;
    private int verticalWheel, horizontalWheel;
    private int movementCount;
    public int MovementCount => Volatile.Read(ref movementCount);
    public int VerticalWheel => Volatile.Read(ref verticalWheel);
    public int HorizontalWheel => Volatile.Read(ref horizontalWheel);
    public MouseObserver() { callback = OnMouse; thread = new Thread(Run) { IsBackground = true }; }
    public Native.Point LastPosition
    {
        get
        {
            long value = Interlocked.Read(ref lastPosition);
            return new Native.Point { X = unchecked((int)(value >> 32)), Y = unchecked((int)value) };
        }
    }
    public Task Start() { thread.Start(); return ready.Task; }
    private void Run()
    {
        Native.SetThreadDpiAwarenessContext(new IntPtr(-4));
        threadId = GetCurrentThreadId();
        handle = SetWindowsHookEx(14, callback, GetModuleHandle(null), 0);
        if (handle == IntPtr.Zero) { ready.TrySetException(new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error())); return; }
        PeekMessage(out _, IntPtr.Zero, 0, 0, 0);
        ready.TrySetResult(true);
        try { while (GetMessage(out _, IntPtr.Zero, 0, 0) > 0) { } }
        finally { UnhookWindowsHookEx(handle); }
    }
    private IntPtr OnMouse(int code, IntPtr message, IntPtr data)
    {
        if (code >= 0)
        {
            var evt = Marshal.PtrToStructure<HookData>(data);
            if ((evt.Flags & 1) != 0)
            {
                if (message.ToInt32() == 0x200)
                {
                    Interlocked.Exchange(ref lastPosition, unchecked(((long)(uint)evt.Point.X << 32) | (uint)evt.Point.Y));
                    Interlocked.Increment(ref movementCount);
                }
                if (message.ToInt32() == 0x20A) { Volatile.Write(ref verticalWheel, unchecked((short)(evt.MouseData >> 16))); return new IntPtr(1); }
                if (message.ToInt32() == 0x20E) { Volatile.Write(ref horizontalWheel, unchecked((short)(evt.MouseData >> 16))); return new IntPtr(1); }
            }
        }
        return CallNextHookEx(handle, code, message, data);
    }
    public void Dispose() { if (thread.IsAlive) { PostThreadMessage(threadId, 0x0012, UIntPtr.Zero, IntPtr.Zero); thread.Join(); } }
    private delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
    [StructLayout(LayoutKind.Sequential)] private struct HookData { public Native.Point Point; public uint MouseData, Flags, Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Sequential)] private struct Message { public IntPtr Hwnd; public uint Value; public UIntPtr WParam; public IntPtr LParam; public uint Time; public Native.Point Pt; public uint Private; }
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr module, uint threadId);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")] private static extern int GetMessage(out Message message, IntPtr hwnd, uint min, uint max);
    [DllImport("user32.dll")] private static extern bool PeekMessage(out Message message, IntPtr hwnd, uint min, uint max, uint remove);
    [DllImport("user32.dll")] private static extern bool PostThreadMessage(uint id, uint message, UIntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string? name);
}
