/*
 * GPU时间查询只包围已有绘制，后续实际帧再读取就绪结果；不等待GPU、不增加渲染循环。
 * 查询归本实例所有，固定最多4项，不能嵌套或结束物理等其他模块的时间查询。
 */
const MAX_PENDING_QUERIES = 4;

function createQueryAdapter(gl) {
    const ext2 = typeof gl.getQueryParameter === 'function' && gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (ext2) return {
        disjoint: () => gl.getParameter(ext2.GPU_DISJOINT_EXT),
        current: () => gl.getQuery(ext2.TIME_ELAPSED_EXT, gl.CURRENT_QUERY),
        create: () => gl.createQuery(), begin: query => gl.beginQuery(ext2.TIME_ELAPSED_EXT, query),
        end: () => gl.endQuery(ext2.TIME_ELAPSED_EXT), remove: query => gl.deleteQuery(query),
        available: query => gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE),
        result: query => gl.getQueryParameter(query, gl.QUERY_RESULT)
    };
    const ext1 = gl.getExtension('EXT_disjoint_timer_query');
    if (!ext1) return null;
    return {
        disjoint: () => gl.getParameter(ext1.GPU_DISJOINT_EXT),
        current: () => ext1.getQueryEXT(ext1.TIME_ELAPSED_EXT, ext1.CURRENT_QUERY_EXT),
        create: () => ext1.createQueryEXT(), begin: query => ext1.beginQueryEXT(ext1.TIME_ELAPSED_EXT, query),
        end: () => ext1.endQueryEXT(ext1.TIME_ELAPSED_EXT), remove: query => ext1.deleteQueryEXT(query),
        available: query => ext1.getQueryObjectEXT(query, ext1.QUERY_RESULT_AVAILABLE_EXT),
        result: query => ext1.getQueryObjectEXT(query, ext1.QUERY_RESULT_EXT)
    };
}

export function createGpuRenderTimer(gl) {
    let adapter = null, active = null, pending = [], generation = 0, status = 'unsupported', disposed = false;
    const lost = () => {
        try { return gl?.isContextLost?.() === true; }
        catch (_error) { return true; }
    };
    const remove = query => {
        // 清理中的驱动异常不能遮蔽原渲染异常，也不能阻止其余查询释放。
        try { adapter?.remove(query); } catch (_error) { /* 查询失效时仅丢弃本地引用。 */ }
    };
    const clear = (canUseGl = true) => {
        if (canUseGl && adapter) {
            if (active) {
                try { if (adapter.current() === active) adapter.end(); } catch (_error) { /* 不结束其他实例查询。 */ }
                remove(active);
            }
            for (const query of pending) remove(query);
        }
        active = null; pending = []; generation += 1;
    };
    const invalidate = nextStatus => {
        if (status !== nextStatus || active || pending.length) clear(nextStatus !== 'lost' && !lost());
        status = nextStatus;
    };
    const detect = () => {
        try {
            adapter = gl?.getExtension ? createQueryAdapter(gl) : null;
            status = lost() ? 'lost' : adapter ? 'supported' : 'unsupported';
        } catch (_error) { adapter = null; status = 'error'; }
    };
    const usable = () => {
        if (disposed) return false;
        if (lost()) { invalidate('lost'); return false; }
        if (!adapter || ['lost', 'error'].includes(status)) return false;
        if (adapter.disjoint()) { invalidate('disjoint'); return false; }
        status = 'supported';
        return true;
    };
    const getState = () => ({ status, generation, pending: pending.length + (active ? 1 : 0) });
    const poll = () => {
        const samples = [];
        try {
            if (usable()) {
                // 按提交顺序收集；不可用只保留，不强制flush/finish或读取结果。
                for (let index = 0; index < pending.length;) {
                    const query = pending[index];
                    if (!adapter.available(query)) { index += 1; continue; }
                    const ns = adapter.result(query);
                    if (Number.isFinite(ns) && ns >= 0) samples.push(ns / 1e6);
                    pending.splice(index, 1); remove(query);
                }
                // 回收过程中若发生计时断裂，本批和此前窗口结果一起失效。
                if (adapter.disjoint()) { samples.length = 0; invalidate('disjoint'); }
            }
        } catch (_error) { samples.length = 0; invalidate('error'); }
        return { samples, status, generation };
    };
    const begin = () => {
        try {
            if (!usable() || active || pending.length >= MAX_PENDING_QUERIES || adapter.current()) return false;
            active = adapter.create();
            if (!active) { invalidate('error'); return false; }
            adapter.begin(active);
            return true;
        } catch (_error) { invalidate('error'); return false; }
    };
    const end = () => {
        if (!active || disposed) return false;
        try {
            if (lost()) { invalidate('lost'); return false; }
            if (adapter.current() !== active) { invalidate('error'); return false; }
            adapter.end(); pending.push(active); active = null;
            return true;
        } catch (_error) { invalidate('error'); return false; }
    };
    const reset = () => {
        if (disposed) return;
        clear(!lost() && status !== 'lost');
        if (status === 'disjoint') status = 'supported';
    };
    const contextLost = () => { if (!disposed) invalidate('lost'); };
    const restore = () => {
        if (disposed) return;
        clear(false); detect();
    };
    const dispose = () => {
        if (disposed) return;
        clear(!lost() && status !== 'lost'); disposed = true; status = 'disposed'; adapter = null;
    };
    detect();
    return Object.freeze({ begin, end, poll, reset, contextLost, restore, dispose, getState });
}
