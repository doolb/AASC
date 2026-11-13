package android.content;
import android.content.res.AssetManager;
public class Context {
    public static final int MODE_PRIVATE = 0;
    private int value = 15;
    private String saved = "";
    public Context getApplicationContext() { return this; }
    public AssetManager getAssets() { return new AssetManager(); }
    public SharedPreferences getSharedPreferences(String name, int mode) {
        return new SharedPreferences() {
            public int getInt(String key, int fallback) { return value; }
            public String getString(String key, String fallback) { return saved.isEmpty() ? fallback : saved; }
            public Editor edit() { return new Editor() {
                public Editor putInt(String key, int number) { value = number; return this; }
                public Editor putString(String key, String text) { saved = text; return this; }
                public boolean commit() { return true; }
            }; }
        };
    }
}
