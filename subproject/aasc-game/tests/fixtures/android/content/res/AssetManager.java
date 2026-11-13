package android.content.res;
import java.io.FileInputStream;
import java.io.InputStream;
public class AssetManager {
    public InputStream open(String file) throws Exception { return new FileInputStream("app/src/main/assets/" + file); }
}
