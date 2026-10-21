package com.aasc.display

/** 只截留本轮官网SDK处理后的参数，不让签名准备请求真正联网。 */
object DoubaoWebViewNodePrepare {
    val script = """
        (() => {
          if (window.__aascDoubaoPrepareRequest) return;
          const original = window.fetch;
          const waiters = new Map();
          const collect = async (input, init, receiver, args) => {
            const url = new URL(input instanceof Request ? input.url : String(input),location.href);
            const body = typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.clone().text() : '';
            let key;
            try { key = JSON.parse(body).option?.unique_key; } catch (_) {}
            const waiter = waiters.get(key);
            if (!waiter) {
              if (url.origin !== 'https://www.doubao.com' || url.pathname !== '/chat/completion') return original.apply(receiver,args);
              for (const value of waiters.values()) value.reject(Error('prepared_mismatch'));
              waiters.clear(); return new Response('',{status:204});
            }
            if (url.origin !== 'https://www.doubao.com' || url.pathname !== '/chat/completion' || body !== waiter.body) {
              waiters.delete(key); waiter.reject(Error('prepared_mismatch')); return new Response('',{status:204});
            }
            const headers = new Headers(input instanceof Request ? input.headers : undefined);
            if (init?.headers) for (const [name,value] of new Headers(init.headers)) headers.set(name,value);
            headers.set('user-agent',navigator.userAgent);
            headers.set('accept','*/*'); headers.set('origin',location.origin);
            headers.set('referer',location.origin + '/chat/');
            const hints = navigator.userAgentData;
            if (hints) {
              headers.set('sec-ch-ua',hints.brands.map(item=>JSON.stringify(item.brand)+';v='+JSON.stringify(item.version)).join(', '));
              headers.set('sec-ch-ua-mobile',hints.mobile ? '?1' : '?0');
              headers.set('sec-ch-ua-platform',JSON.stringify(hints.platform));
            }
            waiters.delete(key);
            waiter.resolve({url:url.href,headers:Object.fromEntries(headers)});
            return new Response('',{status:204});
          };
          window.fetch = function(input,init) {
            if (!waiters.size) return original.apply(this,arguments);
            return collect(input,init,this,arguments);
          };
          window.__aascDoubaoPrepareRequest = (url, options) => new Promise((resolve,reject) => {
            const key = JSON.parse(options.body).option?.unique_key;
            if (typeof key !== 'string' || !key || waiters.size) { reject(Error('prepare_busy')); return; }
            const cleanup = () => {
              clearTimeout(timer); options.signal?.removeEventListener('abort',cancel);
              if (waiters.get(key) === entry) waiters.delete(key);
            };
            const finish = value => { cleanup(); resolve(value); };
            const fail = error => { cleanup(); reject(error); };
            const cancel = () => fail(Error('cancelled'));
            const timer = setTimeout(()=>fail(Error('prepare_timeout')),10000);
            const entry = {body:options.body,resolve:finish,reject:fail};
            waiters.set(key,entry);
            options.signal?.addEventListener('abort',cancel,{once:true});
            if (options.signal?.aborted) { cancel(); return; }
            // 调用SDK包裹后的fetch；底层拦截点匹配unique_key后返回空响应，不访问官网网络。
            Promise.resolve().then(()=>window.fetch(url,options)).then(()=>{
              if (waiters.get(key) === entry) fail(Error('prepare_hook_missing'));
            },fail);
          });
        })();
    """.trimIndent()
}
