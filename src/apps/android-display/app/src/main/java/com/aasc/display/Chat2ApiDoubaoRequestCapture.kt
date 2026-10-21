package com.aasc.display

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.net.URLDecoder
import java.time.Instant
import java.time.format.DateTimeFormatterBuilder

/**
 * 仅从豆包官网新会话的成功聊天请求提取账号级模板。原话、消息ID与网页旧会话在离开
 * WebView 前删除，服务端仍会二次校验；这里只保留后续 Node 构造所需的参数结构。
 */
object Chat2ApiDoubaoRequestCapture {
    /** 在官网消费前保留副本；只有原生校验通过的同次成功新会话才允许精确删除。 */
    val script = """
        (() => {
          if (window.__aascDoubaoCaptureInstalled) return;
          window.__aascDoubaoCaptureInstalled = true;
          const originalFetch = window.fetch;
          if (typeof originalFetch !== 'function') return;
          const bridge = window.AASCDoubaoCapture;
          let sample = null;
          const post = value => bridge?.postMessage(JSON.stringify(value));
          const hasText = value => value && typeof value === 'object' &&
            ((typeof value.text_block?.text === 'string' && value.text_block.text.trim()) ||
              Object.values(value).some(item => item && typeof item === 'object' && hasText(item)));
          const completeId = raw => {
            let text = false, end = false, id = '';
            for (const frame of raw.split(/\r?\n\r?\n/)) {
              const event = frame.match(/(?:^|\n)event:\s*([^\r\n]+)/)?.[1] || '';
              const line = frame.match(/(?:^|\n)data:\s*([^\r\n]+)/)?.[1];
              let data = {};
              try { if (line) data = JSON.parse(line); } catch { return ''; }
              if (event === 'STREAM_ERROR' || Number(data.error_code ?? data.code ?? 0) !== 0) return '';
              if (event === 'SSE_ACK') {
                const next = data.ack_client_meta?.conversation_id;
                if (typeof next !== 'string' || !/^[0-9]{1,32}$/.test(next) || next === '0' || (id && id !== next)) return '';
                id = next;
              }
              if (event === 'CHUNK_DELTA' && typeof data.text === 'string' && data.text.trim()) text = true;
              if (event === 'STREAM_CHUNK' && !['user','human'].includes(data.message?.role) && hasText(data)) text = true;
              if (event === 'SSE_REPLY_END' && !('msg_finish_attr' in data) && !('answer_finish_attr' in data)) end = true;
            }
            return text && end ? id : '';
          };
          const boundedText = async response => {
            const reader = response.body?.getReader();
            if (!reader) return '';
            const decoder = new TextDecoder();
            let raw = '', count = 0;
            try {
              while (true) {
                const next = await reader.read();
                if (next.done) return raw + decoder.decode();
                count += next.value.byteLength;
                if (count > 8388608) { void reader.cancel().catch(() => {}); return ''; }
                raw += decoder.decode(next.value, {stream:true});
              }
            } finally { reader.releaseLock(); }
          };
          const cleanup = async () => {
            if (!sample?.authorized || sample.busy || sample.done || location.origin !== 'https://www.doubao.com') return;
            sample.busy = true;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15000);
            try {
              const query = new URLSearchParams(sample.url.search);
              for (const key of [...query.keys()]) {
                if (!['version_code','language','device_platform','doubao_device_platform','aid','real_aid',
                  'pkg_type','device_id','pc_version','doubao_pc_version','web_id','tea_uuid','region','sys_region',
                  'samantha_web','web_platform','use-olympus-account','web_tab_id'].includes(key)) query.delete(key);
              }
              const result = await originalFetch.call(window,
                '/im/conversation/batch_del_user_conv?' + query.toString(), {
                  method:'POST', credentials:'include', redirect:'error', signal:controller.signal,
                  headers:{'Content-Type':'application/json; encoding=utf-8','agw-js-conv':'str',
                    Accept:'application/json, text/plain, */*'},
                  body:JSON.stringify({cmd:4171,uplink_body:{batch_delete_user_conversation_uplink_body:{
                    conversation_id:[sample.id],delete_all:false,conversation_type:3}},
                    sequence_id:crypto.randomUUID(),channel:2,version:'1'})
                });
              const value = await result.json();
              if (!result.ok || value.status_code !== 0) throw Error('cleanup_failed');
              sample.done = true;
              post({type:'cleanup',sampleId:sample.id,success:true});
            } catch (_) { post({type:'cleanup',sampleId:sample.id,success:false}); }
            finally { clearTimeout(timer); sample.busy = false; }
          };
          if (bridge) bridge.onmessage = event => {
            try {
              const value = JSON.parse(event.data);
              if (value.type === 'cleanup' && value.sampleId === sample?.id) { sample.authorized = true; void cleanup(); }
            } catch (_) {}
          };
          window.__aascDoubaoRetryCleanup = cleanup;
          window.fetch = function(input, init) {
            let observed;
            try {
              const url = new URL(input instanceof Request ? input.url : String(input), location.href);
              const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
              if (!sample && url.origin === 'https://www.doubao.com' && url.pathname === '/chat/completion' && method === 'POST') {
                const headers = new Headers(input instanceof Request ? input.headers : undefined);
                if (init?.headers) for (const [key,value] of new Headers(init.headers)) headers.set(key,value);
                headers.set('user-agent',navigator.userAgent);
                const body = typeof init?.body === 'string' ? Promise.resolve(init.body)
                  : input instanceof Request ? input.clone().text() : Promise.resolve('');
                observed = {url,method,headers,body};
              }
            } catch (_) {}
            const result = originalFetch.apply(this, arguments);
            if (!observed) return result;
            return result.then(response => {
              let copy;
              try { if (response.status === 200) copy = response.clone(); } catch (_) {}
              if (copy) void (async () => {
                try {
                  const body = await observed.body;
                  if (!body || body.length > 262144) { void copy.body?.cancel().catch(() => {}); return; }
                  const parsed = JSON.parse(body);
                  if (parsed.option?.need_create_conversation !== true || parsed.client_meta?.conversation_id !== '') {
                    void copy.body?.cancel().catch(() => {}); return;
                  }
                  const id = completeId(await boundedText(copy));
                  if (!id || sample) return;
                  sample = {id,url:observed.url,busy:false,done:false};
                  post({type:'sample',sampleId:id,url:observed.url.href,method:observed.method,
                    headers:Object.fromEntries(observed.headers),body,verified:true});
                } catch (_) {}
              })();
              return response;
            });
          };
        })();
    """.trimIndent()

    fun normalize(raw: String?): JSONObject? {
        if (raw.isNullOrBlank() || raw.length > 256 * 1024) return null
        return try {
            val input = JSONObject(raw)
            val url = URI(input.getString("url"))
            if (url.scheme != "https" || url.host != "www.doubao.com" || url.port != -1
                || url.path != "/chat/completion" || url.rawUserInfo != null || url.fragment != null
                || input.optString("method") != "POST" || input.optBoolean("verified") != true) return null
            val body = JSONObject(input.getString("body"))
            val meta = body.getJSONObject("client_meta")
            val option = body.getJSONObject("option")
            val message = body.getJSONArray("messages").getJSONObject(0)
            val text = message.getJSONArray("content_block").getJSONObject(0)
                .getJSONObject("content").getJSONObject("text_block").getString("text")
            if (text.isBlank() || option.optBoolean("need_create_conversation") != true
                || meta.optString("conversation_id").isNotEmpty()) return null
            body.remove("messages")
            meta.put("conversation_id", "").put("local_conversation_id", "")
                .put("last_section_id", "").put("last_message_index", JSONObject.NULL)
            option.remove("unique_key")
            option.remove("create_time_ms")
            option.optJSONObject("recovery_option")?.remove("req_create_time_sec")
            if (body.toString().contains(text)) return null
            val query = JSONArray()
            for (part in url.rawQuery.orEmpty().split('&')) {
                if (part.isEmpty()) continue
                val separator = part.indexOf('=')
                val key = URLDecoder.decode(if (separator < 0) part else part.substring(0, separator), "UTF-8")
                val value = URLDecoder.decode(if (separator < 0) "" else part.substring(separator + 1), "UTF-8")
                query.put(JSONArray().put(key).put(value))
            }
            val headers = input.getJSONObject("headers")
            val strippedHeaders = JSONObject()
            for (key in headers.keys()) {
                val lower = key.lowercase()
                if (lower.startsWith(":") || lower in setOf("cookie", "content-length", "host", "connection")) continue
                strippedHeaders.put(lower, headers.optString(key))
            }
            val checkedAt = DateTimeFormatterBuilder().appendInstant(3).toFormatter().format(Instant.now())
            JSONObject().put("version", 1).put("query", query).put("headers", strippedHeaders)
                .put("body", body).put("capturedAt", checkedAt)
                .put("browserVerifiedAt", checkedAt)
        } catch (_: Exception) { null }
    }
}
