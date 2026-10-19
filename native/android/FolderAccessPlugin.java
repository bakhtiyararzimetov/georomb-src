package app.georomb;

// Папка для копий проектов, которую пользователь выбрал сам (системный выбор папки, Storage Access Framework).
// Доступ сохраняется (takePersistableUriPermission) и после перезапуска; после переустановки папку
// выбирают снова — тогда приложению видны и копии прошлой установки. Файлы лежат прямо в выбранной папке.
// JS: app/src/features/autoBackup.ts (FolderApi), app/src/features/backup.ts.

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "FolderAccess")
public class FolderAccessPlugin extends Plugin {

    private static final String PREFS = "georomb_folder";
    private static final String KEY = "treeUri";
    private static final int RW = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
    private static final int MAX_READ = 30 * 1024 * 1024;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Activity.MODE_PRIVATE);
    }

    private ContentResolver resolver() {
        return getContext().getContentResolver();
    }

    /** Сохранённая папка, если доступ к ней ещё есть (его могут отозвать в настройках телефона). */
    private Uri savedTree() {
        String s = prefs().getString(KEY, null);
        if (s == null) return null;
        Uri u = Uri.parse(s);
        for (UriPermission p : resolver().getPersistedUriPermissions()) {
            if (p.getUri().equals(u) && p.isReadPermission() && p.isWritePermission()) return u;
        }
        return null;
    }

    private Uri requireTree(PluginCall call) {
        Uri t = savedTree();
        if (t == null) call.reject("Папка для копий не выбрана", "NO_FOLDER");
        return t;
    }

    private static Uri treeDoc(Uri tree) {
        return DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
    }

    private String folderName(Uri tree) {
        try (Cursor c = resolver().query(treeDoc(tree), new String[] { Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst() && c.getString(0) != null) return c.getString(0);
        } catch (Exception ignored) {
            // имя возьмём из адреса
        }
        String id = DocumentsContract.getTreeDocumentId(tree);
        int i = id.lastIndexOf('/') >= 0 ? id.lastIndexOf('/') : id.lastIndexOf(':');
        return i >= 0 && i < id.length() - 1 ? id.substring(i + 1) : id;
    }

    /** Файл с таким именем прямо в папке; null — нет. */
    private Uri findChild(Uri tree, String name) {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        String[] cols = { Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE };
        try (Cursor c = resolver().query(children, cols, null, null, null)) {
            while (c != null && c.moveToNext()) {
                if (name.equals(c.getString(1)) && !Document.MIME_TYPE_DIR.equals(c.getString(2))) {
                    return DocumentsContract.buildDocumentUriUsingTree(tree, c.getString(0));
                }
            }
        }
        return null;
    }

    private static boolean safeName(String name) {
        return name != null && !name.isEmpty() && name.length() <= 200 && !name.contains("/") && !name.equals("..");
    }

    @PluginMethod
    public void pick(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(RW | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // открываем сохранённую папку или корень памяти телефона — там удобно создать «GeoRomb»
            Uri start = savedTree();
            if (start == null) start = DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:");
            i.putExtra(DocumentsContract.EXTRA_INITIAL_URI, start);
        }
        startActivityForResult(call, i, "pickResult");
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        try {
            handlePick(call, result);
        } finally {
            getBridge().releaseCall(call);       // startActivityForResult сохраняет вызов — отпускаем
        }
    }

    private void handlePick(PluginCall call, ActivityResult result) {
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.reject("Папка не выбрана", "CANCELLED");
            return;
        }
        Uri tree = data.getData();
        try {
            resolver().takePersistableUriPermission(tree, RW);
        } catch (SecurityException e) {
            call.reject("Нет доступа к папке", "NO_PERMISSION");
            return;
        }
        String old = prefs().getString(KEY, null);
        if (old != null && !old.equals(tree.toString())) {
            try {
                resolver().releasePersistableUriPermission(Uri.parse(old), RW);
            } catch (Exception ignored) {
                // доступ к старой папке уже снят
            }
        }
        prefs().edit().putString(KEY, tree.toString()).apply();
        JSObject r = new JSObject();
        r.put("uri", tree.toString());
        r.put("name", folderName(tree));
        call.resolve(r);
    }

    @PluginMethod
    public void current(PluginCall call) {
        Uri t = savedTree();
        JSObject r = new JSObject();
        if (t != null) {
            r.put("uri", t.toString());
            r.put("name", folderName(t));
        }
        call.resolve(r);
    }

    @PluginMethod
    public void list(PluginCall call) {
        Uri tree = requireTree(call);
        if (tree == null) return;
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        String[] cols = { Document.COLUMN_DISPLAY_NAME, Document.COLUMN_LAST_MODIFIED, Document.COLUMN_MIME_TYPE };
        JSArray files = new JSArray();
        try (Cursor c = resolver().query(children, cols, null, null, null)) {
            while (c != null && c.moveToNext()) {
                if (Document.MIME_TYPE_DIR.equals(c.getString(2)) || c.getString(0) == null) continue;
                JSObject f = new JSObject();
                f.put("name", c.getString(0));
                f.put("modified", c.isNull(1) ? 0 : c.getLong(1));
                files.put(f);
            }
        } catch (Exception e) {
            call.reject("Не удалось прочитать папку: " + e.getMessage(), "IO");
            return;
        }
        JSObject r = new JSObject();
        r.put("files", files);
        call.resolve(r);
    }

    @PluginMethod
    public void read(PluginCall call) {
        String name = call.getString("name");
        if (!safeName(name)) { call.reject("Неверное имя файла", "BAD_NAME"); return; }
        Uri tree = requireTree(call);
        if (tree == null) return;
        try {
            Uri doc = findChild(tree, name);
            if (doc == null) { call.reject("Нет файла " + name, "NOT_FOUND"); return; }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (InputStream in = resolver().openInputStream(doc)) {
                if (in == null) throw new java.io.IOException("файл не открылся");
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    if (out.size() > MAX_READ) { call.reject("Файл слишком большой", "TOO_LARGE"); return; }
                }
            }
            JSObject r = new JSObject();
            r.put("data", new String(out.toByteArray(), StandardCharsets.UTF_8));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Не удалось прочитать " + name + ": " + e.getMessage(), "IO");
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        String name = call.getString("name");
        String data = call.getString("data");
        if (!safeName(name) || data == null) { call.reject("Неверное имя файла или пустые данные", "BAD_NAME"); return; }
        Uri tree = requireTree(call);
        if (tree == null) return;
        try {
            Uri doc = findChild(tree, name);
            if (doc == null) doc = DocumentsContract.createDocument(resolver(), treeDoc(tree), "application/json", name);
            if (doc == null) throw new java.io.IOException("файл не создан");
            // "wt" — перезапись с обрезкой: новая копия короче старой не оставит хвост
            try (OutputStream os = resolver().openOutputStream(doc, "wt")) {
                if (os == null) throw new java.io.IOException("файл не открылся для записи");
                os.write(data.getBytes(StandardCharsets.UTF_8));
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Не удалось записать " + name + ": " + e.getMessage(), "IO");
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String name = call.getString("name");
        if (!safeName(name)) { call.reject("Неверное имя файла", "BAD_NAME"); return; }
        Uri tree = requireTree(call);
        if (tree == null) return;
        try {
            Uri doc = findChild(tree, name);
            if (doc != null) DocumentsContract.deleteDocument(resolver(), doc);
            call.resolve();
        } catch (Exception e) {
            call.reject("Не удалось удалить " + name + ": " + e.getMessage(), "IO");
        }
    }
}
