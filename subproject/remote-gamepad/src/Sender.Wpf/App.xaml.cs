using System.Windows;

namespace RemoteGamepad.Wpf;

public partial class App : Application
{
    private void OnStartup(object sender, StartupEventArgs e)
    {
        try { var window = new MainWindow(e.Args); MainWindow = window; window.Show(); }
        catch (Exception ex) { MessageBox.Show(ex.Message, "远程手柄", MessageBoxButton.OK, MessageBoxImage.Error); Shutdown(1); }
    }
}
