using System.ComponentModel;
using System.Runtime.InteropServices;

internal static class GdiCapture
{
    internal sealed record Frame(byte[] Data, int Width, int Height);
    private const int SourceCopy = 0x00CC0020;
    private static readonly Guid JpegEncoder = new("557cf401-1a04-11d3-9a73-0000f81ef32e");
    private static readonly Guid QualityGuid = new("1d5be4b5-fa4a-452d-9cdd-5db35105e7eb");

    // 从当前交互桌面捕获主显示器，所有 GDI 和 GDI+ 对象均在结束时释放。
    public static Frame Capture(int quality)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("截图需要 Windows 交互桌面");
        int width = GetSystemMetrics(0), height = GetSystemMetrics(1);
        if (width <= 0 || height <= 0 || (long)width * height > 100_000_000) throw new InvalidOperationException("主显示器尺寸无效");
        IntPtr screen = IntPtr.Zero, memory = IntPtr.Zero, bitmap = IntPtr.Zero, previous = IntPtr.Zero;
        IntPtr image = IntPtr.Zero, token = IntPtr.Zero, parameterMemory = IntPtr.Zero, qualityMemory = IntPtr.Zero;
        string path = Path.Combine(Path.GetTempPath(), $"remote-gamepad-frame-{Guid.NewGuid():N}.jpg");
        try
        {
            screen = GetDC(IntPtr.Zero);
            if (screen == IntPtr.Zero) throw new Win32Exception();
            memory = CreateCompatibleDC(screen);
            if (memory == IntPtr.Zero) throw new Win32Exception();
            bitmap = CreateCompatibleBitmap(screen, width, height);
            if (bitmap == IntPtr.Zero) throw new Win32Exception();
            previous = SelectObject(memory, bitmap);
            if (previous == IntPtr.Zero || previous == new IntPtr(-1)) throw new Win32Exception();
            if (!BitBlt(memory, 0, 0, width, height, screen, 0, 0, SourceCopy)) throw new Win32Exception();
            var input = new StartupInput { Version = 1 };
            Check(GdiplusStartup(out token, ref input, IntPtr.Zero), "GDI+ 初始化");
            Check(GdipCreateBitmapFromHBITMAP(bitmap, IntPtr.Zero, out image), "转换截图");
            qualityMemory = Marshal.AllocHGlobal(sizeof(int));
            Marshal.WriteInt32(qualityMemory, quality);
            var parameters = new EncoderParameters
            {
                Count = 1,
                Parameter = new EncoderParameter { Guid = QualityGuid, NumberOfValues = 1, Type = 4, Value = qualityMemory }
            };
            parameterMemory = Marshal.AllocHGlobal(Marshal.SizeOf<EncoderParameters>());
            Marshal.StructureToPtr(parameters, parameterMemory, false);
            var encoder = JpegEncoder;
            Check(GdipSaveImageToFile(image, path, ref encoder, parameterMemory), "编码 JPEG");
            return new Frame(File.ReadAllBytes(path), width, height);
        }
        finally
        {
            if (image != IntPtr.Zero) GdipDisposeImage(image);
            if (token != IntPtr.Zero) GdiplusShutdown(token);
            if (parameterMemory != IntPtr.Zero) Marshal.FreeHGlobal(parameterMemory);
            if (qualityMemory != IntPtr.Zero) Marshal.FreeHGlobal(qualityMemory);
            if (previous != IntPtr.Zero && previous != new IntPtr(-1)) SelectObject(memory, previous);
            if (bitmap != IntPtr.Zero) DeleteObject(bitmap);
            if (memory != IntPtr.Zero) DeleteDC(memory);
            if (screen != IntPtr.Zero) ReleaseDC(IntPtr.Zero, screen);
            try { File.Delete(path); } catch (IOException) { }
        }
    }

    private static void Check(int status, string operation)
    {
        if (status != 0) throw new InvalidOperationException($"{operation}失败，GDI+ 状态 {status}");
    }

    [StructLayout(LayoutKind.Sequential)] private struct StartupInput { public uint Version; public IntPtr Callback; public int SuppressBackgroundThread; public int SuppressExternalCodecs; }
    [StructLayout(LayoutKind.Sequential)] private struct EncoderParameter { public Guid Guid; public uint NumberOfValues; public uint Type; public IntPtr Value; }
    [StructLayout(LayoutKind.Sequential)] private struct EncoderParameters { public uint Count; public EncoderParameter Parameter; }
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr window, IntPtr dc);
    [DllImport("gdi32.dll", SetLastError = true)] private static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll", SetLastError = true)] private static extern IntPtr CreateCompatibleBitmap(IntPtr dc, int width, int height);
    [DllImport("gdi32.dll", SetLastError = true)] private static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
    [DllImport("gdi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool BitBlt(IntPtr dest, int x, int y, int width, int height, IntPtr source, int sourceX, int sourceY, int operation);
    [DllImport("gdi32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdiplus.dll")] private static extern int GdiplusStartup(out IntPtr token, ref StartupInput input, IntPtr output);
    [DllImport("gdiplus.dll")] private static extern void GdiplusShutdown(IntPtr token);
    [DllImport("gdiplus.dll")] private static extern int GdipCreateBitmapFromHBITMAP(IntPtr bitmap, IntPtr palette, out IntPtr image);
    [DllImport("gdiplus.dll", CharSet = CharSet.Unicode)] private static extern int GdipSaveImageToFile(IntPtr image, string path, ref Guid encoder, IntPtr parameters);
    [DllImport("gdiplus.dll")] private static extern int GdipDisposeImage(IntPtr image);
}
