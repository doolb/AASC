using System.ComponentModel;
using System.Runtime.InteropServices;

// Lives on the hook's message-loop thread. RIDEV_INPUTSINK receives hardware deltas
// even when this process is not the foreground application.
internal sealed class RawMouseInput : IDisposable
{
    private const uint RidInput = 0x10000003, RidevInputSink = 0x100, RidevRemove = 1;
    private readonly KeyboardRouter router;
    private readonly WindowProc callback;
    private readonly string className = "RemoteGamepadRawMouse_" + Guid.NewGuid().ToString("N");
    private readonly IntPtr instance = GetModuleHandle(null);
    private IntPtr window, buffer;
    private bool classRegistered, deviceRegistered;

    public RawMouseInput(KeyboardRouter router) { this.router = router; callback = OnMessage; }

    public void Start()
    {
        var windowClass = new WindowClass
        {
            Size = (uint)Marshal.SizeOf<WindowClass>(),
            Instance = instance,
            WindowProc = Marshal.GetFunctionPointerForDelegate(callback),
            ClassName = className
        };
        if (RegisterClassEx(ref windowClass) == 0) throw new Win32Exception(Marshal.GetLastWin32Error(), "无法注册原始鼠标输入窗口");
        classRegistered = true;
        window = CreateWindowEx(0, className, "", 0, 0, 0, 0, 0, new IntPtr(-3), IntPtr.Zero, instance, IntPtr.Zero);
        if (window == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "无法创建原始鼠标输入窗口");
        buffer = Marshal.AllocHGlobal(64);
        var device = new RawInputDevice { UsagePage = 1, Usage = 2, Flags = RidevInputSink, Target = window };
        if (!RegisterRawInputDevices(new[] { device }, 1, (uint)Marshal.SizeOf<RawInputDevice>()))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "无法注册原始鼠标输入");
        deviceRegistered = true;
    }

    private IntPtr OnMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam)
    {
        if (message == 0x00FF && router.RelativeCaptureEnabled)
        {
            uint size = 64;
            int headerSize = Marshal.SizeOf<RawInputHeader>();
            uint read = GetRawInputData(lParam, RidInput, buffer, ref size, (uint)headerSize);
            if (read != uint.MaxValue && TryReadRelativeReport(buffer, (int)read, out var dx, out var dy))
                router.MouseMoveRelative(dx, dy);
        }
        return DefWindowProc(hwnd, message, wParam, lParam);
    }

    internal static bool TryReadRelativeReport(IntPtr data, int size, out int dx, out int dy)
    {
        dx = dy = 0;
        int headerSize = Marshal.SizeOf<RawInputHeader>();
        if (data == IntPtr.Zero || size < headerSize + 20 || Marshal.ReadInt32(data) != 0) return false;
        ushort flags = unchecked((ushort)Marshal.ReadInt16(data, headerSize));
        // Absolute devices such as graphics tablets need position mapping instead.
        if ((flags & 1) != 0) return false;
        dx = Marshal.ReadInt32(data, headerSize + 12);
        dy = Marshal.ReadInt32(data, headerSize + 16);
        return true;
    }

    public void Dispose()
    {
        if (deviceRegistered)
        {
            var device = new RawInputDevice { UsagePage = 1, Usage = 2, Flags = RidevRemove, Target = IntPtr.Zero };
            RegisterRawInputDevices(new[] { device }, 1, (uint)Marshal.SizeOf<RawInputDevice>());
            deviceRegistered = false;
        }
        if (window != IntPtr.Zero) { DestroyWindow(window); window = IntPtr.Zero; }
        if (classRegistered) { UnregisterClass(className, instance); classRegistered = false; }
        if (buffer != IntPtr.Zero) { Marshal.FreeHGlobal(buffer); buffer = IntPtr.Zero; }
    }

    [UnmanagedFunctionPointer(CallingConvention.Winapi)] private delegate IntPtr WindowProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct WindowClass
    {
        public uint Size, Style;
        public IntPtr WindowProc;
        public int ClassExtra, WindowExtra;
        public IntPtr Instance, Icon, Cursor, Background;
        [MarshalAs(UnmanagedType.LPWStr)] public string? MenuName;
        [MarshalAs(UnmanagedType.LPWStr)] public string? ClassName;
        public IntPtr IconSmall;
    }
    [StructLayout(LayoutKind.Sequential)] private struct RawInputDevice { public ushort UsagePage, Usage; public uint Flags; public IntPtr Target; }
    [StructLayout(LayoutKind.Sequential)] private struct RawInputHeader { public uint Type, Size; public IntPtr Device, WParam; }
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern ushort RegisterClassEx(ref WindowClass windowClass);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool UnregisterClass(string className, IntPtr instance);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateWindowEx(uint exStyle, string className, string title, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
    [DllImport("user32.dll")] private static extern bool DestroyWindow(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr DefWindowProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool RegisterRawInputDevices(RawInputDevice[] devices, uint count, uint size);
    [DllImport("user32.dll", SetLastError = true)] private static extern uint GetRawInputData(IntPtr raw, uint command, IntPtr data, ref uint size, uint headerSize);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string? name);
}
