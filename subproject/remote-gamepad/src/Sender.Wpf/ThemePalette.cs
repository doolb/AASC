using System.Windows;
using System.Windows.Media;

namespace RemoteGamepad.Wpf;

internal static class ThemePalette
{
    // Keys are shared by the window and control templates; changing resources
    // in place updates existing controls without interrupting the connection.
    private static readonly (string key, string dark, string light)[] Colors =
    {
        ("Page", "#101620", "#F2F6F8"),
        ("Panel", "#1A2431", "#FFFFFF"),
        ("Soft", "#263444", "#E4EBEF"),
        ("Text", "#EDF4F7", "#172C3A"),
        ("Muted", "#A8B9C6", "#506675"),
        ("Accent", "#54D5C6", "#08796E"),
        ("AccentText", "#102627", "#FFFFFF"),
        ("Field", "#101923", "#F7FAFB"),
        ("FieldBorder", "#536B7F", "#AABBC4"),
        ("ButtonFill", "#304557", "#E3EDF0"),
        ("StatusFill", "#203B3D", "#D9F1ED"),
        ("Track", "#344455", "#D5E0E5"),
        ("Focus", "#FFE496", "#9B4A00"),
        ("MetricNormal", "#54D5C6", "#08796E"),
        ("MetricWarn", "#F1C470", "#966100"),
        ("MetricHigh", "#F28383", "#B42C37"),
        ("MetricEmpty", "#506274", "#9EAFB8")
    };

    public static void Apply(bool light)
    {
        foreach (var (key, dark, bright) in Colors)
        {
            var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(light ? bright : dark));
            brush.Freeze();
            Application.Current.Resources[key] = brush;
        }
    }
}
