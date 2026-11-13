using System.ComponentModel;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using RemoteGamepad;

internal static class KeyboardServer
{
    public static async Task Receive(NetworkStream stream, CancellationToken stop)
    {
        await stream.WriteAsync(new byte[] { 1 }, stop);
        Console.WriteLine("键鼠已连接（等待控制端开启）。");
        var held = new Dictionary<(byte, byte, byte), KeyboardPacket>();
        var buttons = new HashSet<byte>();
        var data = new byte[KeyboardPacket.Size];
        try
        {
            while (true)
            {
                await ReadFrame(stream, data, stop);
                var packet = KeyboardPacket.Decode(data);
                if (packet.Operation is KeyboardPacket.Heartbeat or KeyboardPacket.ReleaseAll)
                {
                    if (packet.VirtualKey != 0 || packet.ScanCode != 0 || packet.Extended != 0 || packet.X != 0 || packet.Y != 0) throw new InvalidDataException("无效的键鼠帧");
                    if (packet.Operation == KeyboardPacket.ReleaseAll) { ReleaseButtons(buttons); ReleaseHeld(held); }
                    continue;
                }
                if (packet.Operation == KeyboardPacket.MouseMove)
                {
                    if (packet.VirtualKey != 0 || packet.ScanCode != 0 || packet.Extended != 0) throw new InvalidDataException("无效的鼠标移动帧");
                    InjectMouse(0xC001, packet.X, packet.Y, 0);
                    continue;
                }
                if (packet.Operation == KeyboardPacket.MouseRelative)
                {
                    if (packet.VirtualKey != 0 || packet.ScanCode != 0 || packet.Extended != 0) throw new InvalidDataException("无效的鼠标增量帧");
                    InjectMouse(0x0001, unchecked((short)packet.X), unchecked((short)packet.Y), 0);
                    continue;
                }
                if (packet.Operation is KeyboardPacket.MouseDown or KeyboardPacket.MouseUp)
                {
                    if (packet.VirtualKey is < 1 or > 5 || packet.ScanCode != 0 || packet.Extended != 0 || packet.X != 0 || packet.Y != 0) throw new InvalidDataException("无效的鼠标按键帧");
                    bool release = packet.Operation == KeyboardPacket.MouseUp;
                    if (release && !buttons.Contains(packet.VirtualKey)) continue;
                    if (!release && buttons.Contains(packet.VirtualKey)) continue;
                    InjectButton(packet.VirtualKey, release);
                    if (release) buttons.Remove(packet.VirtualKey); else buttons.Add(packet.VirtualKey);
                    continue;
                }
                if (packet.Operation is KeyboardPacket.MouseWheel or KeyboardPacket.MouseHorizontalWheel)
                {
                    if (packet.VirtualKey != 0 || packet.ScanCode != 0 || packet.Extended != 0 || packet.Y != 0) throw new InvalidDataException("无效的滚轮帧");
                    InjectMouse(packet.Operation == KeyboardPacket.MouseWheel ? 0x0800u : 0x1000u, 0, 0, unchecked((uint)(int)(short)packet.X));
                    continue;
                }
                if (packet.Operation is not (KeyboardPacket.Down or KeyboardPacket.Up) ||
                    packet.VirtualKey == 0 || packet.Extended > 1 || packet.X != 0 || packet.Y != 0) throw new InvalidDataException("无效的键盘事件");
                var id = (packet.VirtualKey, packet.ScanCode, packet.Extended);
                if (packet.Operation == KeyboardPacket.Up && !held.ContainsKey(id)) continue;
                Inject(packet, packet.Operation == KeyboardPacket.Up);
                if (packet.Operation == KeyboardPacket.Down) held[id] = packet;
                else held.Remove(id);
            }
        }
        finally { ReleaseButtons(buttons); ReleaseHeld(held); }
    }

    private static void ReleaseButtons(HashSet<byte> buttons)
    {
        foreach (var button in buttons)
        {
            try { InjectButton(button, true); }
            catch (Win32Exception ex) { Console.Error.WriteLine($"释放鼠标按键失败: {ex.Message}"); }
        }
        buttons.Clear();
    }

    private static void InjectButton(byte button, bool release)
    {
        uint flags = button switch
        {
            1 => release ? 0x0004u : 0x0002u,
            2 => release ? 0x0010u : 0x0008u,
            3 => release ? 0x0040u : 0x0020u,
            4 or 5 => release ? 0x0100u : 0x0080u,
            _ => throw new InvalidDataException("无效的鼠标按键")
        };
        InjectMouse(flags, 0, 0, button is 4 or 5 ? (uint)(button - 3) : 0u);
    }

    private static void InjectMouse(uint flags, int x, int y, uint data)
    {
        var input = new Input { Type = 0, Data = new InputUnion { Mouse = new MouseInput { Flags = flags, X = x, Y = y, Data = data } } };
        if (SendInput(1, new[] { input }, Marshal.SizeOf<Input>()) != 1)
            throw new Win32Exception(Marshal.GetLastWin32Error(), "鼠标 SendInput 失败；检查服务端权限和目标程序权限");
    }

    private static async Task ReadFrame(NetworkStream stream, byte[] data, CancellationToken stop)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop);
        timeout.CancelAfter(TimeSpan.FromSeconds(2));
        await stream.ReadFrameExactlyAsync(data, timeout.Token);
    }

    private static void ReleaseHeld(Dictionary<(byte, byte, byte), KeyboardPacket> held)
    {
        foreach (var packet in held.Values.Reverse())
        {
            try { Inject(packet, true); }
            catch (Win32Exception ex) { Console.Error.WriteLine($"释放按键失败: {ex.Message}"); }
        }
        held.Clear();
    }

    private static void Inject(KeyboardPacket packet, bool release)
    {
        // Scan codes preserve physical-key semantics across different keyboard layouts.
        var keyboard = new KeyboardInput
        {
            VirtualKey = packet.ScanCode == 0 ? packet.VirtualKey : (ushort)0,
            ScanCode = packet.ScanCode,
            Flags = (packet.ScanCode == 0 ? 0u : 8u) | (packet.Extended != 0 ? 1u : 0u) | (release ? 2u : 0u)
        };
        var input = new Input { Type = 1, Data = new InputUnion { Keyboard = keyboard } };
        if (SendInput(1, new[] { input }, Marshal.SizeOf<Input>()) != 1)
            throw new Win32Exception(Marshal.GetLastWin32Error(), "SendInput 失败；检查服务端权限和目标程序权限");
    }

    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, Input[] inputs, int size);
    [StructLayout(LayoutKind.Sequential)] private struct Input { public uint Type; public InputUnion Data; }
    [StructLayout(LayoutKind.Explicit)] private struct InputUnion
    {
        [FieldOffset(0)] public KeyboardInput Keyboard;
        [FieldOffset(0)] public MouseInput Mouse;
    }
    [StructLayout(LayoutKind.Sequential)] private struct KeyboardInput { public ushort VirtualKey, ScanCode; public uint Flags, Time; public UIntPtr ExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] private struct MouseInput { public int X, Y; public uint Data, Flags, Time; public UIntPtr ExtraInfo; }
}
