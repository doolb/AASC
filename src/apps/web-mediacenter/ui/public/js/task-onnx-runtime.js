/** 模型任务需要时才加载ORT；普通显示页面只加载此小型准备器。 */
(function () {
    'use strict';
    let loading = null;

    function prepareRuntime() {
        if (!window.ort || !window.ort.InferenceSession || !window.ort.env?.wasm) throw new Error('ORT脚本未提供推理运行时');
        // 显式指定同源资源，WebGPU的JSEP WASM与动态模块从同一任务依赖目录加载。
        window.ort.env.wasm.wasmPaths = new URL('/js/lib/', window.location.href).href;
        return window.ort;
    }

    async function load() {
        if (window.ort) return prepareRuntime();
        if (loading) return loading;
        const script = document.createElement('script');
        script.src = '/js/lib/ort.webgpu.min.js';
        script.async = true;
        const pending = new Promise((resolve, reject) => {
            let timer;
            const finish = (error) => {
                clearTimeout(timer);
                script.onload = null;
                script.onerror = null;
                if (error) { script.remove(); reject(error); return; }
                try { resolve(prepareRuntime()); } catch (runtimeError) { script.remove(); reject(runtimeError); }
            };
            script.onload = () => finish();
            script.onerror = () => finish(new Error('ORT任务依赖加载失败，请重试任务'));
            timer = setTimeout(() => finish(new Error('ORT任务依赖脚本加载超时')), 30000);
            document.head.appendChild(script);
        });
        loading = pending;
        try { return await pending; }
        catch (error) { if (loading === pending) loading = null; throw error; }
    }

    window.TaskOnnxRuntime = Object.freeze({ load });
})();
