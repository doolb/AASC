using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using RemoteGamepad;

namespace RemoteGamepad.Wpf;

public partial class MainWindow : Window
{
    private readonly SenderSettings settings = new();
    private readonly DispatcherTimer timer = new() { Interval = TimeSpan.FromMilliseconds(500) };
    private readonly Action<string> logSink;
    private ClientSession? session;
    private bool initializing = true, busy, closing, allowClose;
    private string? modeOverride, macArgument;
    private string? loadedHost, textBeforeEdit;
    private TextBox? editingTextBox;
    private const string NavigationHint = "方向键定位 · 回车操作 / 编辑 · Esc 取消编辑 · F1 帮助";
    private string network = "未连接", pad = "--", audio = "--", input = "--";

    public MainWindow(string[] args)
    {
        ThemePalette.Apply(settings.Theme == "light");
        InitializeComponent();
        ApplyZoom(settings.Zoom);
        ThemeButton.Content = settings.Theme == "light" ? "深色主题" : "亮色主题";
        logSink = OnLog;
        SenderLog.Use(logSink);
        try
        {
            bool noAutoConnect = args.Contains("--no-auto-connect");
            args = args.Where(a => a != "--no-auto-connect").ToArray();
            if (!PowerArguments.TryExtract(args, out var rest, out macArgument, out var error)) throw new ArgumentException(error);
            bool aggregate = rest.Contains("--aggregate");
            rest = rest.Where(a => a != "--aggregate").ToArray();
            var modes = rest.Where(a => a is "--relative" or "--absolute").ToArray();
            if (modes.Length > 1) throw new ArgumentException("鼠标模式只能指定一次。");
            modeOverride = modes.FirstOrDefault();
            rest = rest.Where(a => a is not ("--relative" or "--absolute")).ToArray();
            if (rest.Length > 3 || (rest.Length > 1 && (!int.TryParse(rest[1], out var p) || p is < 1 or > 65535)) ||
                (rest.Length > 2 && (!uint.TryParse(rest[2], out var slot) || slot > 3)))
                throw new ArgumentException("用法: Sender.Wpf [服务端IP] [端口] [手柄编号] [--aggregate] [--mac MAC] [--relative|--absolute]");
            HostBox.Text = rest.Length > 0 ? rest[0] : settings.LastHost ?? "";
            AggregateCheck.IsChecked = aggregate;
            PortBox.Text = rest.Length > 1 ? rest[1] : aggregate ? "26762" : "26760";
            SlotBox.Text = rest.Length > 2 ? rest[2] : "0";
            LoadTargetSettings();
            if (macArgument != null) MacBox.Text = macArgument;
            if (modeOverride != null) { RelativeMode.IsChecked = modeOverride == "--relative"; AbsoluteMode.IsChecked = modeOverride == "--absolute"; }
            initializing = false;
            SleepButton.IsEnabled = InputToggle.IsEnabled = false;
            timer.Tick += (_, _) => RefreshUi(); timer.Start();
            Loaded += async (_, _) =>
            {
                if (string.IsNullOrWhiteSpace(HostBox.Text)) HostBox.Focus(); else ConnectButton.Focus();
                if (!noAutoConnect && !string.IsNullOrWhiteSpace(HostBox.Text)) await ConnectAsync();
            };
        }
        catch { SenderLog.Clear(logSink); throw; }
    }
    private void Theme_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            bool light = settings.Theme != "light";
            settings.SetTheme(light ? "light" : "dark");
            ThemePalette.Apply(light);
            ThemeButton.Content = light ? "深色主题" : "亮色主题";
            RefreshUi();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.Text.Json.JsonException)
        { MessageBox.Show(this, $"无法保存主题设置: {ex.Message}", "主题", MessageBoxButton.OK, MessageBoxImage.Error); }
    }
    private void Window_GotKeyboardFocus(object sender, KeyboardFocusChangedEventArgs e)
    {
        if (e.NewFocus is FrameworkElement element) element.BringIntoView();
    }
    private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        var modifiers = Keyboard.Modifiers;
        if ((modifiers & ModifierKeys.Control) != 0 && (modifiers & (ModifierKeys.Alt | ModifierKeys.Windows)) == 0 && HandleZoomKey(e.Key))
        { e.Handled = true; return; }
        if (e.Key == Key.F1 && Keyboard.Modifiers == ModifierKeys.None)
        {
            MessageBox.Show(this,
                "方向键：定位所有控件；回车或空格：操作按钮和开关\n输入框：回车开始编辑，回车确认，Esc 取消\n编辑时方向键移动光标；Tab / Shift+Tab 也可切换控件\n\n" +
                "Alt+H：服务端地址    Alt+M：MAC 地址\nAlt+C：连接 / 断开    Alt+W：网络唤醒\nAlt+S：服务端睡眠    Alt+T：切换主题\n" +
                "Alt+I：键鼠转发       Alt+A：断线自动睡眠\nAlt+1 / Alt+2：绝对 / 增量鼠标模式\nAlt+V：保存 MAC       Alt+F4：关闭窗口\nCtrl+加号 / 减号：缩放    Ctrl+0：恢复 100%\n\n" +
                "转发开启时，先按 Ctrl+Esc 关闭转发，才能在本地操作界面。",
                "键盘快捷键", MessageBoxButton.OK, MessageBoxImage.Information);
            e.Handled = true;
            return;
        }
        if (Keyboard.Modifiers == ModifierKeys.Alt)
        {
            Key key = e.Key == Key.System ? e.SystemKey : e.Key;
            e.Handled = HandleShortcut(key);
            return;
        }
        if (Keyboard.Modifiers != ModifierKeys.None) return;
        e.Handled = HandleNavigationKey(e.Key, Keyboard.FocusedElement);
    }
    private bool HandleZoomKey(Key key)
    {
        double? next = key switch
        {
            Key.OemPlus or Key.Add => settings.Zoom + 0.1,
            Key.OemMinus or Key.Subtract => settings.Zoom - 0.1,
            Key.D0 or Key.NumPad0 => 1.0,
            _ => null
        };
        if (next == null) return false;
        try { settings.SetZoom(next.Value); ApplyZoom(settings.Zoom); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.Text.Json.JsonException)
        { MessageBox.Show(this, $"无法保存缩放设置: {ex.Message}", "缩放", MessageBoxButton.OK, MessageBoxImage.Error); }
        return true;
    }
    private void ApplyZoom(double zoom)
    {
        RootGrid.LayoutTransform = new ScaleTransform(zoom, zoom);
        ZoomLabel.Text = $"{zoom * 100:F0}%";
        UpdateZoomLayout();
    }
    private void ZoomViewport_SizeChanged(object sender, SizeChangedEventArgs e) => UpdateZoomLayout();
    private void UpdateZoomLayout()
    {
        if (RootGrid == null || ZoomViewport == null || ZoomViewport.ActualWidth <= 0) return;
        // The horizontal scroller measures its child at infinite width; explicitly
        // fit the unscaled grid to the viewport unless its minimum requires scrolling.
        RootGrid.Width = Math.Max(RootGrid.MinWidth, (ZoomViewport.ActualWidth - 52) / settings.Zoom);
    }
    private bool HandleNavigationKey(Key key, IInputElement? current)
    {
        if (current is TextBox box && ReferenceEquals(box, editingTextBox))
        {
            if (key == Key.Enter) { EndTextEdit(false); return true; }
            if (key == Key.Escape) { EndTextEdit(true); return true; }
            return false;
        }
        if (key == Key.Enter && current is TextBox textBox && textBox.IsEnabled)
        { BeginTextEdit(textBox); return true; }
        if (key == Key.Enter && current is Button button && button.IsEnabled)
        { button.RaiseEvent(new RoutedEventArgs(Button.ClickEvent, button)); return true; }
        if (key == Key.Enter && current is CheckBox check && check.IsEnabled)
        { check.IsChecked = check.IsChecked != true; return true; }
        if (key is Key.Enter or Key.Space && current is RadioButton radio && radio.IsEnabled)
        { radio.IsChecked = true; return true; }
        if (key is not (Key.Left or Key.Right or Key.Up or Key.Down)) return false;
        bool forward = key is Key.Right or Key.Down;
        var target = GetNavigationTarget(current, forward);
        if (target != null) { target.Focus(); target.BringIntoView(); }
        return true;
    }
    private Control? GetNavigationTarget(IInputElement? current, bool forward)
    {
        // Limit directional navigation to actionable controls. In particular,
        // generated log items and scrollbars must never trap keyboard focus.
        Control[] all = { ThemeButton, HostBox, PortBox, SlotBox, MacBox, AggregateCheck,
            ConnectButton, InputToggle, AbsoluteMode, RelativeMode, AutoSleep,
            WakeButton, SleepButton, SaveMacButton };
        var available = all.Where(control => control.IsEnabled && control.Focusable && control.Visibility == Visibility.Visible).ToArray();
        if (available.Length == 0) return null;
        int index = Array.FindIndex(available, control => ReferenceEquals(control, current) || control.IsKeyboardFocusWithin);
        if (index < 0) return forward ? available[0] : available[^1];
        return available[(index + (forward ? 1 : available.Length - 1)) % available.Length];
    }
    private void BeginTextEdit(TextBox box)
    {
        if (ReferenceEquals(editingTextBox, box)) return;
        EndTextEdit(false);
        editingTextBox = box; textBeforeEdit = box.Text; box.IsReadOnly = false;
        KeyboardHelp.Text = "正在编辑 · 回车确认 · Esc 取消 · 方向键移动光标";
    }
    private void EndTextEdit(bool cancel)
    {
        if (editingTextBox == null) return;
        var box = editingTextBox; editingTextBox = null;
        if (cancel) box.Text = textBeforeEdit ?? "";
        textBeforeEdit = null; box.IsReadOnly = true; KeyboardHelp.Text = NavigationHint;
        if (ReferenceEquals(box, HostBox)) ReloadTargetIfChanged();
    }
    private void TextBox_MouseDown(object sender, MouseButtonEventArgs e)
    { if (sender is TextBox box && box.IsEnabled) BeginTextEdit(box); }
    private void TextBox_LostKeyboardFocus(object sender, KeyboardFocusChangedEventArgs e)
    { if (ReferenceEquals(sender, editingTextBox)) EndTextEdit(false); }
    private bool HandleShortcut(Key key)
    {
        UIElement? target = key switch
        {
            Key.H => HostBox, Key.M => MacBox,
            Key.C => ConnectButton, Key.W => WakeButton, Key.S => SleepButton,
            Key.T => ThemeButton, Key.V => SaveMacButton,
            Key.I => InputToggle, Key.A => AutoSleep,
            Key.D1 => AbsoluteMode, Key.D2 => RelativeMode,
            _ => null
        };
        if (target == null) return false;
        if (target.IsEnabled)
        {
            EndTextEdit(false);
            if (target is Button button) button.RaiseEvent(new RoutedEventArgs(Button.ClickEvent, button));
            else if (target is CheckBox check) check.IsChecked = check.IsChecked != true;
            else if (target is RadioButton radio) radio.IsChecked = true;
            else target.Focus();
        }
        return true;
    }
    private void LoadTargetSettings()
    {
        string host = HostBox.Text.Trim();
        loadedHost = host;
        var saved = settings.Get(host);
        MacBox.Text = saved.Mac ?? "";
        AutoSleep.IsChecked = saved.AutoSleep;
        RelativeMode.IsChecked = saved.RelativeMouse; AbsoluteMode.IsChecked = !saved.RelativeMouse;
        MacStatus.Text = string.IsNullOrWhiteSpace(saved.Mac) ? "MAC 未设置" : $"MAC  {saved.Mac}";
    }
    private void Host_LostFocus(object sender, RoutedEventArgs e)
    {
        ReloadTargetIfChanged();
    }
    private void ReloadTargetIfChanged()
    {
        if (initializing || session != null || StringComparer.OrdinalIgnoreCase.Equals(loadedHost, HostBox.Text.Trim())) return;
        initializing = true; LoadTargetSettings(); initializing = false;
    }
    private void Aggregate_Changed(object sender, RoutedEventArgs e)
    {
        if (initializing || PortBox == null) return;
        if (PortBox.Text is "26760" or "26762") PortBox.Text = AggregateCheck.IsChecked == true ? "26762" : "26760";
    }
    private async void Connect_Click(object sender, RoutedEventArgs e)
    {
        if (busy) return;
        if (session != null) await DisconnectAsync(); else await ConnectAsync();
    }
    private async Task ConnectAsync()
    {
        if (busy || session != null) return;
        string host = HostBox.Text.Trim();
        if (host.Length == 0 || !int.TryParse(PortBox.Text, out int port) || port is < 1 or > 65535 || !uint.TryParse(SlotBox.Text, out uint slot) || slot > 3)
        { MessageBox.Show(this, "请填写服务端地址、有效端口和 0–3 的手柄编号。", "连接", MessageBoxButton.OK, MessageBoxImage.Information); return; }
        busy = true;
        try
        {
            session = new ClientSession(settings, host, port, slot, AggregateCheck.IsChecked == true, RelativeMode.IsChecked == true, MacBox.Text.Trim());
            session.Power.SetAutoEnabled(AutoSleep.IsChecked == true);
            SetConnectingControls(true);
            network = "正在连接"; pad = audio = input = "--";
            HeaderStatus.Text = "●  正在连接";
            session.Start();
        }
        catch (Exception ex)
        {
            if (session != null) { try { await session.StopAsync(); } catch { } session = null; }
            SetConnectingControls(false);
            MessageBox.Show(this, ex.Message, "无法连接", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally { busy = false; }
    }
    private async Task DisconnectAsync()
    {
        if (busy || session == null) return;
        busy = true; ConnectButton.IsEnabled = false;
        var old = session;
        try { await old.StopAsync(); }
        catch (Exception ex) { OnLog($"断开时出现错误: {ex.Message}"); }
        finally
        {
            session = null; network = "未连接"; pad = audio = input = "--";
            SetConnectingControls(false); ConnectButton.IsEnabled = true; busy = false; RefreshUi();
        }
    }
    private void SetConnectingControls(bool connected)
    {
        HostBox.IsEnabled = PortBox.IsEnabled = SlotBox.IsEnabled = AggregateCheck.IsEnabled = !connected;
        ConnectButton.Content = connected ? "断开" : "连接";
        SleepButton.IsEnabled = connected;
    }
    private void Input_Changed(object sender, RoutedEventArgs e)
    {
        if (initializing || session == null) return;
        if (!session.Router.TrySetInputEnabled(InputToggle.IsChecked == true, out var reason))
        { OnLog(reason); initializing = true; InputToggle.IsChecked = session.Router.InputEnabled; initializing = false; }
    }
    private void MouseMode_Changed(object sender, RoutedEventArgs e)
    {
        if (initializing || RelativeMode == null || AbsoluteMode == null) return;
        bool relative = RelativeMode.IsChecked == true;
        if (session != null)
        {
            if (!session.Router.TrySetMouseMode(relative, out var reason))
            {
                OnLog(reason); initializing = true; RelativeMode.IsChecked = session.Router.RelativeMouse; AbsoluteMode.IsChecked = !session.Router.RelativeMouse; initializing = false;
            }
            else OnLog(reason);
        }
        else if (!string.IsNullOrWhiteSpace(HostBox.Text))
        {
            try { settings.Update(HostBox.Text.Trim(), value => value with { RelativeMouse = relative }); }
            catch (Exception ex) { OnLog($"保存鼠标模式失败: {ex.Message}"); }
        }
    }
    private async void AutoSleep_Changed(object sender, RoutedEventArgs e)
    {
        if (initializing || HostBox == null || string.IsNullOrWhiteSpace(HostBox.Text)) return;
        bool value = AutoSleep.IsChecked == true;
        try
        {
            if (session != null)
            {
                session.Power.SetAutoEnabled(value);
                if (!value) await session.Power.CancelPendingSleepAsync();
            }
            else settings.Update(HostBox.Text.Trim(), old => old with { AutoSleep = value });
        }
        catch (Exception ex) { OnLog($"自动睡眠设置: {ex.Message}"); }
    }
    private PowerClient? GetPower()
    {
        if (session != null) return session.Power;
        string host = HostBox.Text.Trim();
        if (host.Length == 0 || !int.TryParse(PortBox.Text, out int port) || port is < 1 or > 65535)
        { MessageBox.Show(this, "请先填写服务端地址和端口。", "电源", MessageBoxButton.OK, MessageBoxImage.Information); return null; }
        return new PowerClient(host, host, port, settings);
    }
    private void SaveMac_Click(object sender, RoutedEventArgs e)
    {
        try { var power = GetPower(); if (power == null) return; power.SetMac(MacBox.Text.Trim()); MacStatus.Text = $"MAC  {power.MacText}"; }
        catch (Exception ex) { MessageBox.Show(this, ex.Message, "MAC 地址", MessageBoxButton.OK, MessageBoxImage.Error); }
    }
    private async void Wake_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var power = GetPower(); if (power == null) return;
            if (!string.IsNullOrWhiteSpace(MacBox.Text)) power.SetMac(MacBox.Text.Trim());
            if (power.MacText == "未设置") throw new InvalidOperationException("请先设置服务端有线网卡的 MAC 地址。");
            MacStatus.Text = $"MAC  {power.MacText}";
            // Starting a session sends the wake packet and keeps retrying while
            // the remote machine and its service resume. A live session is
            // already reconnecting, so only send another packet in that case.
            if (session == null) await ConnectAsync();
            else await power.WakeAsync();
        }
        catch (Exception ex) { MessageBox.Show(this, ex.Message, "唤醒", MessageBoxButton.OK, MessageBoxImage.Error); }
    }
    private async void Sleep_Click(object sender, RoutedEventArgs e)
    {
        if (session == null || MessageBox.Show(this, "确定让服务端进入睡眠吗？", "服务端睡眠", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
        try { await session.Power.SleepAsync(CancellationToken.None); }
        catch (Exception ex) { MessageBox.Show(this, ex.Message, "睡眠请求失败", MessageBoxButton.OK, MessageBoxImage.Error); }
    }
    private void OnLog(string line)
    {
        if (Dispatcher.HasShutdownStarted) return;
        _ = Dispatcher.BeginInvoke(() =>
        {
            LogList.Items.Add($"{DateTime.Now:HH:mm:ss}  {line}");
            while (LogList.Items.Count > 120) LogList.Items.RemoveAt(0);
            if (LogList.Items.Count > 0) LogList.ScrollIntoView(LogList.Items[^1]);
            if (line.StartsWith("已连接 ")) network = "已连接";
            else if (line.StartsWith("连接中断:")) { network = "正在重连"; pad = "--"; }
            else if (line == "手柄已连接") pad = "已连接";
            else if (line == "手柄未连接，发送中性状态") pad = "未检测到";
            else if (line.StartsWith("音频播放已连接")) audio = "已连接";
            else if (line.StartsWith("音频连接中断")) audio = "正在重连";
            else if (line.StartsWith("键鼠已连接")) input = "已连接";
            else if (line.StartsWith("键鼠连接中断")) input = "正在重连";
            else if (line.StartsWith("键鼠捕获不可用")) input = "不可用";
            RefreshUi();
        });
    }
    private void RefreshUi()
    {
        bool active = session != null;
        HeaderStatus.Text = $"●  {network}";
        ConnectionStatus.Text = $"手柄 {pad}   ·   声音 {audio}   ·   键鼠 {input}";
        initializing = true;
        InputToggle.IsEnabled = active && input == "已连接";
        InputToggle.IsChecked = active && session!.Router.InputEnabled;
        AbsoluteMode.IsEnabled = RelativeMode.IsEnabled = !active || !session!.Router.InputEnabled;
        if (active) { RelativeMode.IsChecked = session!.Router.RelativeMouse; AbsoluteMode.IsChecked = !session.Router.RelativeMouse; MacStatus.Text = $"MAC  {session.Power.MacText}"; }
        initializing = false;
        InputStatus.Text = !active ? "未连接" : session!.Router.InputEnabled ? "键鼠转发中" : input == "已连接" ? "键鼠已连接，转发关闭" : $"键鼠 {input}";
        var snapshot = session?.Telemetry.Read(); var sample = snapshot?.Stale == false ? snapshot.Value.Sample : null;
        SetMetric(CpuValue, CpuBar, sample?.CpuPercent);
        SetMetric(MemoryValue, MemoryBar, Percentage(sample?.MemoryUsedBytes, sample?.MemoryTotalBytes));
        SetMetric(GpuValue, GpuBar, sample?.GpuPercent);
        SetMetric(VramValue, VramBar, Percentage(sample?.GpuMemoryUsedBytes, sample?.GpuMemoryTotalBytes));
        CpuPower.Text = $"功耗 {Watts(sample?.CpuPowerWatts)}"; GpuPower.Text = $"功耗 {Watts(sample?.GpuPowerWatts)}";
        MemoryDetail.Text = $"{Bytes(sample?.MemoryUsedBytes)} / {Bytes(sample?.MemoryTotalBytes)}";
        VramDetail.Text = $"{Bytes(sample?.GpuMemoryUsedBytes)} / {Bytes(sample?.GpuMemoryTotalBytes)}";
        ForegroundValue.Text = sample == null ? "等待性能数据" : $"{sample.ForegroundApp ?? "--"}   {(sample.ForegroundFps == null ? sample.FpsStatus : sample.FpsStatus is "RTSS" or "RTSS 子进程" or "前台子进程" ? sample.FpsStatus : sample.GpuName) ?? ""}";
        FpsValue.Text = sample?.ForegroundFps is double fps ? fps.ToString("F1") : "--";
    }
    private static void SetMetric(TextBlock label, ProgressBar bar, double? value)
    {
        bool available = value is double n && double.IsFinite(n);
        label.Text = available ? $"{value:F1}%" : "--";
        bar.Value = available ? Math.Clamp(value!.Value, 0, 100) : 0;
        bar.SetResourceReference(Control.ForegroundProperty, !available ? "MetricEmpty" : value >= 90 ? "MetricHigh" : value >= 70 ? "MetricWarn" : "MetricNormal");
    }
    private static double? Percentage(ulong? used, ulong? total) => used is ulong u && total is ulong t && t > 0 ? 100.0 * u / t : null;
    private static string Bytes(ulong? value) => value is ulong n ? $"{n / 1073741824.0:F1} GiB" : "--";
    private static string Watts(double? value) => value is double n && double.IsFinite(n) ? $"{n:F1} W" : "-- W";
    private async void Window_Closing(object? sender, CancelEventArgs e)
    {
        if (allowClose) return;
        e.Cancel = true;
        if (closing) return;
        closing = true; timer.Stop();
        while (busy) await Task.Delay(50);
        if (session != null) await DisconnectAsync();
        SenderLog.Clear(logSink); allowClose = true;
        _ = Dispatcher.BeginInvoke(new Action(Close));
    }
}
