// res/tasks/render-display/task.js
// 硬件监控仪表盘渲染任务
// target=display — 在显示端浏览器主线程加载 render.html/render.js
// 不含 run() 函数，执行代码在 render.js 中，由 display.html 的 executeRenderTask 直接注入

module.exports = {
    id: 'render-display',
    name: '硬件监控仪表盘',
    description: '在显示端展示 CPU/GPU/内存实时仪表盘（Canvas 渲染覆盖层）',
    target: 'display',
    mode: 'service',
    params: [
        { name: 'fullscreen', type: 'toggle', default: false, label: '全屏模式' }
    ]
};
