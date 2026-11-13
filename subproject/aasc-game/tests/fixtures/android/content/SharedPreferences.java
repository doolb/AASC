package android.content;
public interface SharedPreferences {
    int getInt(String key, int fallback);
    String getString(String key, String fallback);
    Editor edit();
    interface Editor { Editor putInt(String key, int value); Editor putString(String key, String value); boolean commit(); }
}
