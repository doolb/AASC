/* MindAR 编译器适配：强制传递进度回调，避免目标编译阶段因缺少回调而中断。 */
(function exposeMmdArBenchmarkCompiler(root, factory) {
    'use strict';

    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.MmdArBenchmarkCompiler = api;
}(typeof globalThis === 'object' ? globalThis : this, function createMmdArBenchmarkCompiler() {
    'use strict';

    async function compileImageTargets(compiler, images, onProgress) {
        if (!compiler || typeof compiler.compileImageTargets !== 'function') {
            throw new Error('MindAR 编译器不可用');
        }
        if (typeof onProgress !== 'function') {
            throw new Error('MindAR 编译必须提供进度回调');
        }
        return compiler.compileImageTargets(images, onProgress);
    }

    return Object.freeze({ compileImageTargets });
}));
