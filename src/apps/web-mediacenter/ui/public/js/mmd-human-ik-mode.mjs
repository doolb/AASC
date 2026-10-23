// 页面启用人体物理的异步入口，独立于面板UI，便于验证加载迟到/模型切换。
export async function ensureInteractivePhysics(api, { isCurrent = () => true } = {}) {
    const check = () => { if (!isCurrent()) throw new DOMException('应用已取消', 'AbortError'); };
    check();
    const token = api.getState().token, current = api.getInteractiveIKState();
    if (current.mode === 'physics' && current.enabled && current.available) return current;
    await api.setInteractiveIKMode('physics');
    check();
    if (api.getState().token !== token) throw new Error('模型已切换，请重试');
    if (api.getInteractiveIKState().mode !== 'physics') throw new Error('身体物理初始化已失效，请重试');
    if (!api.getInteractiveIKState().enabled) api.setInteractiveIKEnabled(true);
    const state = api.getInteractiveIKState();
    if (state.mode !== 'physics' || !state.available) throw new Error(state.reason || '身体物理未就绪');
    return state;
}
