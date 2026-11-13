using Terminal.Gui;
using System.Text;

// Terminal.Gui owns the terminal on its UI thread. Network threads only append
// state and events; a UI timer takes snapshots without touching views cross-thread.
internal sealed class TerminalDashboard : IDisposable
{
    private readonly object gate = new();
    private readonly Queue<string> events = new();
    private readonly Action<string> eventSink;
    private readonly string host;
    private readonly int port;
    private readonly bool aggregate;
    private readonly uint slot;
    private readonly KeyboardRouter router;
    private readonly TelemetryState telemetry;
    private readonly PowerClient power;
    private readonly CancellationTokenSource applicationStop;
    private readonly TaskCompletionSource<bool> ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private Thread? uiThread;
    private bool disposed;
    private int revision;
    private string network = "正在连接", controller = "等待状态", audio = "正在连接", input = "正在连接", aggregateState = "正在连接";

    private TerminalDashboard(string host, int port, uint slot, KeyboardRouter router, TelemetryState telemetry, PowerClient power, bool aggregate, CancellationTokenSource stop)
    {
        this.host = host; this.port = port; this.slot = slot; this.router = router; this.telemetry = telemetry; this.power = power; this.aggregate = aggregate; applicationStop = stop;
        eventSink = WriteLine;
    }

    public static TerminalDashboard? TryStart(string host, int port, uint slot, KeyboardRouter router, TelemetryState telemetry, PowerClient power, bool aggregate, CancellationTokenSource stop)
    {
        if (Console.IsInputRedirected || Console.IsOutputRedirected) return null;
        var dashboard = new TerminalDashboard(host, port, slot, router, telemetry, power, aggregate, stop);
        try
        {
            SenderLog.Use(dashboard.eventSink);
            dashboard.uiThread = new Thread(dashboard.RunUi) { IsBackground = true, Name = "terminal dashboard" };
            dashboard.uiThread.Start();
            dashboard.ready.Task.GetAwaiter().GetResult();
            return dashboard;
        }
        catch (Exception ex)
        {
            dashboard.Dispose();
            Console.Error.WriteLine($"终端界面不可用，使用普通日志: {ex.Message}");
            return null;
        }
    }

    public void WriteLine(string? value)
    {
        if (value == null) return;
        lock (gate)
        {
            UpdateStatus(value);
            events.Enqueue($"{DateTime.Now:HH:mm:ss}  {value}");
            while (events.Count > 100) events.Dequeue();
            revision++;
        }
    }
    private void UpdateStatus(string line)
    {
        if (line.StartsWith("聚合已连接")) aggregateState = "已连接";
        else if (line.StartsWith("聚合连接中断")) aggregateState = "正在重连";
        else if (line.StartsWith("已连接 ")) network = "已连接";
        else if (line.StartsWith("连接中断:")) { network = "正在重连"; controller = "等待状态"; }
        else if (line == "手柄已连接") controller = "已连接";
        else if (line == "手柄未连接，发送中性状态") controller = "未检测到";
        else if (line.StartsWith("音频播放已连接")) audio = "已连接";
        else if (line.StartsWith("音频连接中断")) audio = "正在重连";
        else if (line.StartsWith("键鼠已连接")) input = line.Contains("转发开启") ? "已连接 / 转发开启" : "已连接 / 转发关闭";
        else if (line.StartsWith("键鼠转发已开启")) input = "已连接 / 转发开启";
        else if (line.StartsWith("键鼠转发已关闭")) input = "已连接 / 转发关闭";
        else if (line.StartsWith("键鼠连接中断")) input = "正在重连 / 转发关闭";
        else if (line.StartsWith("键鼠捕获不可用") || line.Contains("键盘功能已禁用")) input = "不可用";
        else if (line.Contains("音频已禁用")) audio = "不可用";
    }

    private void RunUi()
    {
        bool started = false;
        bool previousDriver = Application.UseSystemConsole;
        Encoding? previousEncoding = null;
        try
        {
            if (OperatingSystem.IsWindows() && !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("WT_SESSION")))
            {
                // WindowsDriver's WriteConsoleOutput path mishandles double-width
                // CJK glyphs in Windows Terminal. Use its VT renderer instead.
                previousEncoding = Console.OutputEncoding;
                Console.OutputEncoding = new UTF8Encoding(false);
                Application.UseSystemConsole = true;
            }
            Application.Init();
            var baseColors = Scheme(Color.Gray);
            var logColors = Scheme(Color.Gray);
            logColors.Focus = logColors.Normal;
            logColors.HotFocus = logColors.Normal;
            var accentColors = Scheme(Color.BrightCyan);
            var mutedColors = Scheme(Color.DarkGray);
            var goodColors = Scheme(Color.BrightGreen);
            var warningColors = Scheme(Color.BrightYellow);
            var highColors = Scheme(Color.BrightRed);
            var window = new Window(" 远程手柄 · 控制台 ") { X = 0, Y = 0, Width = Dim.Fill(), Height = Dim.Fill(), ColorScheme = baseColors };
            var endpoint = new Label("") { X = 2, Y = 0, Width = Dim.Fill(2), ColorScheme = accentColors };
            var connectionTitle = new Label("连接状态  ------------------------------------------------") { X = 2, Y = 2, Width = Dim.Fill(2), ColorScheme = accentColors };
            var networkLabel = new Label("") { X = 2, Y = 3, Width = Dim.Fill(2) };
            var audioLabel = new Label("") { X = 2, Y = 4, Width = Dim.Fill(2) };
            var inputLabel = new Label("") { X = 2, Y = 5, Width = Dim.Fill(2) };
            var metricsTitle = new Label("服务端性能  ----------------------------------------------") { X = 2, Y = 6, Width = Dim.Fill(2), ColorScheme = accentColors };
            var cpuLabel = new Label("") { X = 2, Y = 7, Width = Dim.Fill(2) };
            var memoryLabel = new Label("") { X = 2, Y = 8, Width = Dim.Fill(2) };
            var gpuLabel = new Label("") { X = 2, Y = 9, Width = Dim.Fill(2) };
            var vramLabel = new Label("") { X = 2, Y = 10, Width = Dim.Fill(2) };
            var fpsLabel = new Label("") { X = 2, Y = 11, Width = Dim.Fill(2) };
            var controlsTitle = new Label("输入控制  ------------------------------------------------") { X = 2, Y = 12, Width = Dim.Fill(2), ColorScheme = accentColors };
            var modeLabel = new Label("") { X = 2, Y = 13, Width = 18 };
            var absolute = new Button("绝对模式") { X = 21, Y = 13 };
            var relative = new Button("增量模式") { X = Pos.Right(absolute) + 2, Y = 13 };
            var quit = new Button("退出") { X = Pos.Right(relative) + 3, Y = 13 };
            var wake = new Button("唤醒") { X = 2, Y = 14 };
            var sleep = new Button("睡眠") { X = Pos.Right(wake) + 2, Y = 14 };
            var configureMac = new Button("设置 MAC") { X = Pos.Right(sleep) + 2, Y = 14 };
            var macLabel = new Label("") { X = Pos.Right(configureMac) + 2, Y = 14, Width = Dim.Fill(2), ColorScheme = mutedColors };
            var autoSleep = new CheckBox("断开 60 秒后睡眠", power.AutoEnabled) { X = 2, Y = 15 };
            var hint = new Label("Ctrl+Esc 开关键鼠  ·  Q 退出") { X = Pos.Right(autoSleep) + 2, Y = 15, Width = Dim.Fill(2), ColorScheme = mutedColors };
            var logTitle = new Label("最近事件  ------------------------------------------------") { X = 2, Y = 17, Width = Dim.Fill(2), ColorScheme = accentColors };
            var log = new TextView { X = 2, Y = 18, Width = Dim.Fill(2), Height = Dim.Fill(1), ReadOnly = true, CanFocus = false, WordWrap = false, ColorScheme = logColors };
            BindModeButtons(absolute, relative, router, WriteLine);
            quit.Clicked += RequestStop;
            void ConfigureMac()
            {
                var save = new Button("保存"); var cancel = new Button("取消");
                var dialog = new Dialog("设置服务端网卡 MAC", 58, 9, save, cancel);
                var text = new TextField(power.MacText == "未设置" ? "" : power.MacText) { X = 2, Y = 2, Width = Dim.Fill(2) };
                dialog.Add(new Label("请输入服务端有线网卡 MAC 地址：") { X = 2, Y = 0 }, text);
                save.Clicked += () =>
                {
                    try { power.SetMac(text.Text.ToString() ?? ""); Application.RequestStop(); }
                    catch (Exception ex) when (ex is ArgumentException or IOException or UnauthorizedAccessException or System.Text.Json.JsonException)
                    { MessageBox.ErrorQuery("无法保存", ex.Message, "确定"); }
                };
                cancel.Clicked += () => Application.RequestStop();
                Application.Run(dialog);
                dialog.Dispose();
            }
            configureMac.Clicked += ConfigureMac;
            bool resettingAuto = false;
            autoSleep.Toggled += previous =>
            {
                if (resettingAuto) return;
                try
                {
                    power.SetAutoEnabled(autoSleep.Checked);
                    if (!autoSleep.Checked)
                        _ = Task.Run(async () => { try { await power.CancelPendingSleepAsync(); } catch (Exception ex) { WriteLine($"未能通知服务端取消倒计时: {ex.Message}"); } });
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.Text.Json.JsonException)
                {
                    resettingAuto = true; autoSleep.Checked = power.AutoEnabled; resettingAuto = false;
                    MessageBox.ErrorQuery("无法保存设置", ex.Message, "确定");
                }
            };
            wake.Clicked += () =>
            {
                if (power.MacText == "未设置") { ConfigureMac(); if (power.MacText == "未设置") return; }
                _ = Task.Run(async () => { try { await power.WakeAsync(); } catch (Exception ex) { WriteLine($"唤醒失败: {ex.Message}"); } });
            };
            sleep.Clicked += () =>
            {
                if (MessageBox.Query("服务端睡眠", "确定让服务端进入睡眠吗？", "取消", "睡眠") != 1) return;
                _ = Task.Run(async () => { try { await power.SleepAsync(applicationStop.Token); } catch (Exception ex) { WriteLine($"睡眠请求失败: {ex.Message}"); } });
            };
            Application.RootKeyEvent = e =>
            {
                if (e.Key is Key.Q or Key.q || e.Key == (Key.CtrlMask | Key.C))
                { RequestStop(); return true; }
                return false;
            };
            window.Add(endpoint, connectionTitle, networkLabel, audioLabel, inputLabel, metricsTitle, cpuLabel, memoryLabel, gpuLabel, vramLabel, fpsLabel, controlsTitle, modeLabel, absolute, relative, quit, wake, sleep, configureMac, macLabel, autoSleep, hint, logTitle, log);
            int previousRevision = -1, previousRows = -1, previousColumns = -1, previousMetrics = -1;
            bool? previousMode = null, previousEnabled = null, previousStale = null;
            Application.MainLoop.AddTimeout(TimeSpan.FromMilliseconds(200), _ =>
            {
                if (applicationStop.IsCancellationRequested) { Application.RequestStop(); return false; }
                string net, pad, sound, keyboard, logText, aggregateStatus;
                int currentRevision, rows = Application.Driver.Rows, columns = Application.Driver.Cols;
                bool currentMode = router.RelativeMouse, currentEnabled = router.InputEnabled;
                var metrics = telemetry.Read();
                lock (gate)
                {
                    currentRevision = revision;
                    if (currentRevision == previousRevision && rows == previousRows && columns == previousColumns && currentMode == previousMode && currentEnabled == previousEnabled && metrics.Version == previousMetrics && metrics.Stale == previousStale) return true;
                    net = network; pad = controller; sound = audio; keyboard = input; aggregateStatus = aggregateState;
                    logText = string.Join(Environment.NewLine, events.TakeLast(Math.Max(1, rows - 22)));
                }
                endpoint.Text = $"服务端  {host}:{port}    {(aggregate ? "聚合 " + aggregateStatus : "直连")}    手柄 #{slot}";
                networkLabel.Text = $"手柄网络: {net}      设备: {pad}";
                audioLabel.Text = $"声音: {sound}      端口: {(aggregate ? "聚合" : port < 65535 ? (port + 1).ToString() : "不可用")}";
                inputLabel.Text = $"键鼠: {keyboard}      端口: {(aggregate ? "聚合" : port.ToString())}";
                var sample = metrics.Stale ? null : metrics.Sample;
                int barWidth = Math.Clamp(columns - 50, 8, 20);
                cpuLabel.Text = $"CPU  {ProgressBar(sample?.CpuPercent, barWidth)} {Percent(sample?.CpuPercent)}  {Watts(sample?.CpuPowerWatts)}";
                memoryLabel.Text = $"内存 {ProgressBar(UsagePercent(sample?.MemoryUsedBytes, sample?.MemoryTotalBytes), barWidth)} {Bytes(sample?.MemoryUsedBytes)} / {Bytes(sample?.MemoryTotalBytes)}";
                gpuLabel.Text = $"GPU  {ProgressBar(sample?.GpuPercent, barWidth)} {Percent(sample?.GpuPercent)}  {Watts(sample?.GpuPowerWatts)}  {sample?.GpuName ?? ""}";
                vramLabel.Text = $"显存 {ProgressBar(UsagePercent(sample?.GpuMemoryUsedBytes, sample?.GpuMemoryTotalBytes), barWidth)} {Bytes(sample?.GpuMemoryUsedBytes)} / {Bytes(sample?.GpuMemoryTotalBytes)}";
                ColorScheme MeterColor(double? value) => value is not double n || !double.IsFinite(n) ? mutedColors : n >= 90 ? highColors : n >= 70 ? warningColors : goodColors;
                cpuLabel.ColorScheme = MeterColor(sample?.CpuPercent);
                memoryLabel.ColorScheme = MeterColor(UsagePercent(sample?.MemoryUsedBytes, sample?.MemoryTotalBytes));
                gpuLabel.ColorScheme = MeterColor(sample?.GpuPercent);
                vramLabel.ColorScheme = MeterColor(UsagePercent(sample?.GpuMemoryUsedBytes, sample?.GpuMemoryTotalBytes));
                fpsLabel.Text = $"前台: {sample?.ForegroundApp ?? "--"}   FPS: {(sample?.ForegroundFps is double fps ? fps.ToString("F1") : "--")} {(sample?.ForegroundFps == null || sample?.FpsStatus is "前台子进程" or "RTSS" or "RTSS 子进程" ? sample?.FpsStatus ?? "" : "")}";
                modeLabel.Text = $"鼠标模式: {(currentMode ? "增量" : "绝对")}";
                absolute.Enabled = relative.Enabled = !currentEnabled;
                macLabel.Text = $"MAC: {power.MacText}";
                log.Text = logText;
                previousRevision = currentRevision; previousRows = rows; previousColumns = columns; previousMode = currentMode; previousEnabled = currentEnabled; previousMetrics = metrics.Version; previousStale = metrics.Stale;
                return true;
            });
            started = true;
            ready.TrySetResult(true);
            Application.Run(window);
        }
        catch (Exception ex)
        {
            if (!started) ready.TrySetException(ex);
            else WriteLine($"终端界面结束: {ex.Message}");
        }
        finally
        {
            try { Application.Shutdown(); } catch { }
            Application.UseSystemConsole = previousDriver;
            if (previousEncoding != null) try { Console.OutputEncoding = previousEncoding; } catch (IOException) { }
            if (started && !applicationStop.IsCancellationRequested) RequestStop();
        }
    }

    private static string Percent(double? value) => value is double n && double.IsFinite(n) ? $"{n:F1}%" : "--";
    private static string Watts(double? value) => value is double n && double.IsFinite(n) ? $"{n:F1} W" : "-- W";
    private static ColorScheme Scheme(Color foreground) => new()
    {
        Normal = Terminal.Gui.Attribute.Make(foreground, Color.Black),
        Focus = Terminal.Gui.Attribute.Make(Color.Black, Color.BrightCyan),
        HotNormal = Terminal.Gui.Attribute.Make(Color.BrightCyan, Color.Black),
        HotFocus = Terminal.Gui.Attribute.Make(Color.Black, Color.BrightCyan),
        Disabled = Terminal.Gui.Attribute.Make(Color.DarkGray, Color.Black)
    };
    private static string Bytes(ulong? value) => value is ulong n ? $"{n / 1073741824.0:F1} GiB" : "--";
    internal static double? UsagePercent(ulong? used, ulong? total) => used is ulong u && total is ulong t && t > 0 ? 100.0 * u / t : null;
    internal static string ProgressBar(double? percent, int width)
    {
        if (width < 1) throw new ArgumentOutOfRangeException(nameof(width));
        if (percent is not double value || !double.IsFinite(value)) return "[" + new string('?', width) + "]";
        double clamped = Math.Clamp(value, 0, 100);
        int filled = (int)Math.Round(clamped / 100 * width, MidpointRounding.AwayFromZero);
        if (clamped > 0 && filled == 0) filled = 1;
        return "[" + new string('#', filled) + new string('-', width - filled) + "]";
    }

    internal static void BindModeButtons(Button absolute, Button relative, KeyboardRouter router, Action<string> report)
    {
        void ChangeMode(bool value)
        {
            router.TrySetMouseMode(value, out string message);
            report(message);
        }
        absolute.Clicked += () => ChangeMode(false);
        relative.Clicked += () => ChangeMode(true);
    }

    private void RequestStop() => ThreadPool.QueueUserWorkItem(_ =>
    {
        try { applicationStop.Cancel(); } catch (ObjectDisposedException) { }
    });

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        if (uiThread is { IsAlive: true })
        {
            try { Application.MainLoop?.Invoke(() => Application.RequestStop()); } catch { }
            if (Thread.CurrentThread != uiThread) uiThread.Join();
        }
        SenderLog.Clear(eventSink);
    }
}
