// Keep application logs separate from Console.Out: Terminal.Gui itself writes
// terminal control sequences there, including alternate-screen enter/exit.
internal static class SenderLog
{
    private static Action<string>? sink;
    public static void Use(Action<string> output) => Interlocked.Exchange(ref sink, output);
    public static void Clear(Action<string> output) => Interlocked.CompareExchange(ref sink, null, output);
    public static void WriteLine(string message)
    {
        var output = Volatile.Read(ref sink);
        if (output == null) Console.WriteLine(message);
        else output(message);
    }
}
