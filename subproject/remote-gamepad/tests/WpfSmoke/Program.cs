using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Input;
using System.Reflection;
using RemoteGamepad.Wpf;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        // The window is never shown or connected. Its configuration lives in
        // this test's build output, not in the user's release directory.
        string path = Path.Combine(AppContext.BaseDirectory, "settings.json");
        byte[]? original = File.Exists(path) ? File.ReadAllBytes(path) : null;
        try
        {
            File.WriteAllText(path, "{\"Version\":2,\"LastHost\":null,\"Targets\":{}}");
            var app = new App(); app.InitializeComponent();
            var window = new MainWindow(new[] { "--no-auto-connect" });
            var theme = (Button)window.FindName("ThemeButton");
            var connect = (Button)window.FindName("ConnectButton");
            var input = (CheckBox)window.FindName("InputToggle");
            var autoSleep = (CheckBox)window.FindName("AutoSleep");
            var relative = (RadioButton)window.FindName("RelativeMode");
            var shortcut = typeof(MainWindow).GetMethod("HandleShortcut", BindingFlags.Instance | BindingFlags.NonPublic)!;
            var navigation = typeof(MainWindow).GetMethod("HandleNavigationKey", BindingFlags.Instance | BindingFlags.NonPublic)!;
            var nextTarget = typeof(MainWindow).GetMethod("GetNavigationTarget", BindingFlags.Instance | BindingFlags.NonPublic)!;
            var zoomKey = typeof(MainWindow).GetMethod("HandleZoomKey", BindingFlags.Instance | BindingFlags.NonPublic)!;
            bool Invoke(Key key) => (bool)shortcut.Invoke(window, new object[] { key })!;
            bool Zoom(Key key) => (bool)zoomKey.Invoke(window, new object[] { key })!;
            bool Navigate(Key key, IInputElement element) => (bool)navigation.Invoke(window, new object[] { key, element })!;
            Control Target(IInputElement element, bool forward) => (Control)nextTarget.Invoke(window, new object[] { element, forward })!;
            var port = (TextBox)window.FindName("PortBox");
            var log = (ListBox)window.FindName("LogList");
            var saveMac = (Button)window.FindName("SaveMacButton");
            var absolute = (RadioButton)window.FindName("AbsoluteMode");
            var root = (Grid)window.FindName("RootGrid");
            var zoomLabel = (TextBlock)window.FindName("ZoomLabel");
            if (!Zoom(Key.OemPlus) || ((ScaleTransform)root.LayoutTransform).ScaleX != 1.1 || zoomLabel.Text != "110%" || !File.ReadAllText(path).Contains("\"Zoom\": 1.1"))
                throw new Exception("zoom in and persistence failed");
            if (!Zoom(Key.Subtract) || ((ScaleTransform)root.LayoutTransform).ScaleX != 1.0 || Zoom(Key.F12))
                throw new Exception("zoom out or unrelated key handling failed");
            for (int i = 0; i < 15; i++) Zoom(Key.Add);
            if (((ScaleTransform)root.LayoutTransform).ScaleX != 2.0) throw new Exception("maximum zoom not enforced");
            Render(window, "remote-gamepad-zoom.png");
            if (!Zoom(Key.D0) || ((ScaleTransform)root.LayoutTransform).ScaleX != 1.0) throw new Exception("reset zoom failed");
            if (!ReferenceEquals(Target(log, true), theme) || !ReferenceEquals(Target(log, false), saveMac) ||
                !ReferenceEquals(Target(theme, false), saveMac) || !ReferenceEquals(Target(saveMac, true), theme) ||
                !ReferenceEquals(Target(connect, true), absolute) || !Navigate(Key.Up, log))
                throw new Exception("navigation must escape logs, wrap, and skip disabled controls");
            if (!port.IsReadOnly || !Navigate(Key.Right, port) || !Navigate(Key.Enter, port) || port.IsReadOnly)
                throw new Exception("arrow navigation and entering text editing failed");
            port.Text = "12345";
            if (Navigate(Key.Left, port) || !Navigate(Key.Escape, port) || !port.IsReadOnly || port.Text != "26760")
                throw new Exception("text editing cursor or cancel failed");
            Navigate(Key.Enter, port); port.Text = "26761"; Navigate(Key.Enter, port);
            if (!port.IsReadOnly || port.Text != "26761") throw new Exception("text edit confirmation failed");
            if (!Navigate(Key.Enter, autoSleep) || autoSleep.IsChecked != true || !Navigate(Key.Enter, autoSleep) || autoSleep.IsChecked != false)
                throw new Exception("Enter should toggle checkboxes");
            if (!Navigate(Key.Enter, relative) || relative.IsChecked != true || !Navigate(Key.Left, relative))
                throw new Exception("radio keyboard navigation failed");
            if (!theme.Focusable || !connect.Focusable || !theme.IsTabStop || !connect.IsTabStop || input.FocusVisualStyle == null)
                throw new Exception("keyboard navigation or focus indicator unavailable");
            if (window.Background is not SolidColorBrush dark || dark.Color != (Color)ColorConverter.ConvertFromString("#101620"))
                throw new Exception("default dark theme was not applied");
            if (!Invoke(Key.T)) throw new Exception("theme shortcut not recognized");
            if (window.Background is not SolidColorBrush light || light.Color != (Color)ColorConverter.ConvertFromString("#F2F6F8") || !File.ReadAllText(path).Contains("\"Theme\": \"light\""))
                throw new Exception("light theme did not apply and persist");
            Render(window, "remote-gamepad-light.png");
            if (!Invoke(Key.A) || autoSleep.IsChecked != true || !Invoke(Key.A) || autoSleep.IsChecked != false)
                throw new Exception("automatic sleep shortcut did not toggle");
            if (!Invoke(Key.D2) || relative.IsChecked != true || !Invoke(Key.D1) || relative.IsChecked != false)
                throw new Exception("mouse mode shortcuts did not select their modes");
            if (!Invoke(Key.I) || input.IsChecked == true || !Invoke(Key.S) || Invoke(Key.F12))
                throw new Exception("disabled or unknown shortcuts must not execute an action");
            if (!Invoke(Key.T)) throw new Exception("theme shortcut not recognized");
            if (window.Background is not SolidColorBrush again || again.Color != dark.Color || !File.ReadAllText(path).Contains("\"Theme\": \"dark\""))
                throw new Exception("dark theme did not restore");
            Render(window, "remote-gamepad-dark.png");
            Console.WriteLine("PASS: offline WPF shortcuts, disabled controls, theme and focus styles");
        }
        finally
        {
            if (original == null) File.Delete(path); else File.WriteAllBytes(path, original);
        }
    }
    private static void Render(Window window, string filename)
    {
        var content = (FrameworkElement)window.Content;
        content.Measure(new Size(1120, 820));
        content.Arrange(new Rect(0, 0, 1120, 820));
        content.UpdateLayout();
        var image = new RenderTargetBitmap(1120, 820, 96, 96, PixelFormats.Pbgra32);
        var background = new DrawingVisual();
        using (var drawing = background.RenderOpen()) drawing.DrawRectangle(window.Background, null, new Rect(0, 0, 1120, 820));
        image.Render(background);
        image.Render(content);
        var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(image));
        using var file = File.Create(Path.Combine(AppContext.BaseDirectory, filename)); encoder.Save(file);
    }
}
