package io.github.rivierepierrev.saudade;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * A folder of the phone kept in sync by another app (Syncthing…), for the
 * synchronisation (src/mobile/webdavSync.ts). The folder is chosen once through
 * Android's picker, which grants lasting access to it; paths are names inside it
 * ("x.log", "media/y.enc"). File contents travel in base64.
 */
@CapacitorPlugin(name = "SyncFolder")
public class SyncFolderPlugin extends Plugin {
    private static final int ACCESS = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;

    private static class Entry {
        String id;
        String name;
        long size;
        boolean dir;
    }

    @PluginMethod
    public void pick(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(ACCESS | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, intent, "picked");
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.resolve(new JSObject());
            return;
        }
        Uri tree = data.getData();
        try {
            resolver().takePersistableUriPermission(tree, ACCESS);
            JSObject out = new JSObject();
            out.put("uri", tree.toString());
            Entry root = root(tree);
            out.put("name", root.name == null ? "Dossier" : root.name);
            call.resolve(out);
        } catch (Exception e) {
            fail(call, e);
        }
    }

    @PluginMethod
    public void list(PluginCall call) {
        try {
            Uri tree = tree(call);
            Entry dir = find(tree, call.getString("path", ""));
            JSObject out = new JSObject();
            if (dir == null || !dir.dir) {
                out.put("exists", false);
                call.resolve(out);
                return;
            }
            JSArray files = new JSArray();
            for (Entry e : children(tree, dir.id)) {
                if (e.dir) continue;
                JSObject f = new JSObject();
                f.put("name", e.name);
                f.put("size", e.size);
                files.put(f);
            }
            out.put("exists", true);
            out.put("files", files);
            call.resolve(out);
        } catch (Exception e) {
            fail(call, e);
        }
    }

    @PluginMethod
    public void read(PluginCall call) {
        try {
            Uri tree = tree(call);
            Entry file = find(tree, call.getString("path", ""));
            JSObject out = new JSObject();
            if (file == null || file.dir) {
                out.put("exists", false);
                call.resolve(out);
                return;
            }
            long from = call.getData().optLong("from", 0L);
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (InputStream in = resolver().openInputStream(DocumentsContract.buildDocumentUriUsingTree(tree, file.id))) {
                if (in == null) throw new FileNotFoundException(file.name);
                long skipped = 0;
                while (skipped < from) {
                    long n = in.skip(from - skipped);
                    if (n <= 0) break;
                    skipped += n;
                }
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) bytes.write(buf, 0, n);
            }
            out.put("exists", true);
            out.put("data", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
            call.resolve(out);
        } catch (Exception e) {
            fail(call, e);
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        try {
            Uri tree = tree(call);
            String path = call.getString("path", "");
            byte[] data = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
            int slash = path.lastIndexOf('/');
            Entry parent = find(tree, slash < 0 ? "" : path.substring(0, slash));
            String name = path.substring(slash + 1);
            if (parent == null || !parent.dir) throw new FileNotFoundException(path);
            Entry existing = child(tree, parent.id, name);
            Uri doc = existing != null
                ? DocumentsContract.buildDocumentUriUsingTree(tree, existing.id)
                : DocumentsContract.createDocument(resolver(), DocumentsContract.buildDocumentUriUsingTree(tree, parent.id), "application/octet-stream", name);
            if (doc == null) throw new IOException("création de " + name + " impossible");
            try (OutputStream os = resolver().openOutputStream(doc, "wt")) {
                if (os == null) throw new IOException("écriture de " + name + " impossible");
                os.write(data);
            }
            call.resolve();
        } catch (Exception e) {
            fail(call, e);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        try {
            Uri tree = tree(call);
            Entry file = find(tree, call.getString("path", ""));
            if (file != null) DocumentsContract.deleteDocument(resolver(), DocumentsContract.buildDocumentUriUsingTree(tree, file.id));
            call.resolve();
        } catch (Exception e) {
            fail(call, e);
        }
    }

    // ---- Helpers ----------------------------------------------------------------

    private ContentResolver resolver() {
        return getContext().getContentResolver();
    }

    private Uri tree(PluginCall call) {
        return Uri.parse(call.getString("uri", ""));
    }

    private void fail(PluginCall call, Exception e) {
        if (e instanceof SecurityException) call.reject("accès au dossier perdu : choisissez-le à nouveau");
        else call.reject(e.getMessage() == null ? e.toString() : e.getMessage());
    }

    private Entry root(Uri tree) {
        Entry root = new Entry();
        root.id = DocumentsContract.getTreeDocumentId(tree);
        root.dir = true;
        try (Cursor c = resolver().query(DocumentsContract.buildDocumentUriUsingTree(tree, root.id), new String[] {Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) root.name = c.getString(0);
        }
        return root;
    }

    private List<Entry> children(Uri tree, String parentId) {
        List<Entry> out = new ArrayList<>();
        String[] columns = {Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_SIZE, Document.COLUMN_MIME_TYPE};
        try (Cursor c = resolver().query(DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId), columns, null, null, null)) {
            while (c != null && c.moveToNext()) {
                Entry e = new Entry();
                e.id = c.getString(0);
                e.name = c.getString(1);
                e.size = c.isNull(2) ? 0 : c.getLong(2);
                e.dir = Document.MIME_TYPE_DIR.equals(c.getString(3));
                out.add(e);
            }
        }
        return out;
    }

    private Entry child(Uri tree, String parentId, String name) {
        for (Entry e : children(tree, parentId)) if (name.equals(e.name)) return e;
        return null;
    }

    /** The entry at `path` inside the folder ("" = the folder itself), or null. */
    private Entry find(Uri tree, String path) {
        Entry at = new Entry();
        at.id = DocumentsContract.getTreeDocumentId(tree);
        at.dir = true;
        for (String part : path.split("/")) {
            if (part.isEmpty()) continue;
            if (!at.dir) return null;
            at = child(tree, at.id, part);
            if (at == null) return null;
        }
        return at;
    }
}
