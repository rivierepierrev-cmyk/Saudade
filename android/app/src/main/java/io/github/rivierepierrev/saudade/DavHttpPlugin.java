package io.github.rivierepierrev.saudade;

import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * HTTP for the WebDAV synchronisation (src/mobile/webdavSync.ts). Android's
 * HttpURLConnection, behind CapacitorHttp, refuses WebDAV methods (PROPFIND, MKCOL);
 * OkHttp accepts any method. Replies carry the body in base64.
 */
@CapacitorPlugin(name = "DavHttp")
public class DavHttpPlugin extends Plugin {
    private final OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .build();

    @PluginMethod
    public void request(final PluginCall call) {
        String url = call.getString("url");
        String method = call.getString("method", "GET");
        String body = call.getString("body");
        JSObject headers = call.getObject("headers", new JSObject());

        Request.Builder builder;
        try {
            builder = new Request.Builder().url(url);
        } catch (IllegalArgumentException e) {
            call.reject("Adresse invalide : " + url);
            return;
        }
        String contentType = null;
        Iterator<String> keys = headers.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            String value = headers.optString(key);
            if (key.equalsIgnoreCase("Content-Type")) contentType = value;
            else builder.header(key, value);
        }
        MediaType type = contentType == null ? null : MediaType.parse(contentType);
        RequestBody requestBody = null;
        if (body != null) requestBody = RequestBody.create(body.getBytes(StandardCharsets.UTF_8), type);
        else if (method.equals("PUT") || method.equals("POST")) requestBody = RequestBody.create(new byte[0], type);

        Request request;
        try {
            request = builder.method(method, requestBody).build();
        } catch (IllegalArgumentException e) {
            call.reject(e.getMessage());
            return;
        }
        client.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call c, IOException e) {
                call.reject(e.getMessage() == null ? e.toString() : e.getMessage());
            }

            @Override
            public void onResponse(Call c, Response response) {
                try (ResponseBody responseBody = response.body()) {
                    byte[] bytes = responseBody == null ? new byte[0] : responseBody.bytes();
                    JSObject out = new JSObject();
                    out.put("status", response.code());
                    out.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
                    call.resolve(out);
                } catch (IOException e) {
                    call.reject(e.getMessage() == null ? e.toString() : e.getMessage());
                }
            }
        });
    }
}
