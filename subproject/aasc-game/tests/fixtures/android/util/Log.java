package android.util;
public class Log {
    public static int e(String tag, String message) { System.err.println(message); return 0; }
    public static int e(String tag, String message, Throwable error) { System.err.println(message + ": " + error); return 0; }
}
