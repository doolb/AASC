// 每个PMX运行时有独立覆盖状态；名称、类型和分组全部来自当前加载的模型。
export function createManualExpressions({ getMesh, getProfile, getHelper, onChanged }) {
    let mesh = null, key = '', items = [], helper = null, originalHook = null, hook = null;
    let applied = false;
    const selected = new Map();
    const underlying = new Map();

    function restore() {
        if (mesh?.morphTargetInfluences) {
            for (const [index, value] of underlying) mesh.morphTargetInfluences[index] = value;
        }
        underlying.clear();
    }

    function unhook() {
        // 只还原仍由本实例拥有的回调，避免覆盖其他功能后来设置的回调。
        if (helper && helper.onBeforePhysics === hook) helper.onBeforePhysics = originalHook;
        helper = originalHook = hook = null;
    }

    function bind() {
        const next = getMesh();
        if (next === mesh) return;
        restore();
        unhook();
        const profile = getProfile();
        const metadata = next?.geometry?.userData?.MMD?.morphs || [];
        const nextItems = metadata.map((item, index) => ({ ...item, index,
            supported: item.supported === true && index < (next.morphTargetInfluences?.length || 0) }));
        const nextKey = JSON.stringify([profile?.modelUrl, profile?.resourceId,
            nextItems.map(item => [item.name, item.type, item.panel])]);
        // 同模型物理重载保留选择；换模型或Morph索引变化则清空，不能仅按名称复用。
        if (nextKey !== key) selected.clear();
        mesh = next;
        items = nextItems;
        key = nextKey;
        applied = false;
    }

    function apply() {
        if (!mesh?.morphTargetInfluences || applied) return;
        for (const [index, weight] of selected) {
            underlying.set(index, mesh.morphTargetInfluences[index]);
            mesh.morphTargetInfluences[index] = weight;
        }
        applied = true;
    }

    function bindHelper(nextHelper) {
        if (nextHelper && nextHelper !== helper) {
            // 新动作已经由播放器重置Morph；不能把旧动作的基线写回新helper。
            if (!helper) restore();
            else underlying.clear();
            unhook();
            helper = nextHelper;
        }
        if (helper && helper.onBeforePhysics !== hook) {
            const previousHook = helper.onBeforePhysics;
            originalHook = previousHook;
            hook = function (...args) {
                const result = previousHook?.apply(this, args);
                if (args[0] === mesh) apply();
                return result;
            };
            helper.onBeforePhysics = hook;
        }
    }

    function before(nextHelper) {
        bind();
        bindHelper(nextHelper);
        restore();
        applied = false;
    }

    function set(index, weight) {
        bind();
        // 控件事件也可能落在动作切换完成与下一帧之间，先同步helper才能恢复正确基线。
        bindHelper(getHelper());
        if (!Number.isInteger(index) || !items[index]?.supported) throw new Error('当前模型不支持这个表情');
        if (weight !== null && !Number.isFinite(weight)) throw new Error('表情强度必须是有效数字');
        restore();
        if (weight === null) selected.delete(index);
        else selected.set(index, Math.max(0, Math.min(1, weight)));
        applied = false;
        apply();
        onChanged();
        return true;
    }

    function clear() {
        bind();
        bindHelper(getHelper());
        restore();
        selected.clear();
        applied = false;
        onChanged();
        return true;
    }

    return {
        before,
        after: apply,
        set,
        clear,
        getState() {
            bind();
            return { token: mesh?.uuid || '', ready: Boolean(mesh?.isSkinnedMesh),
                items: items.map(item => ({ ...item, selected: selected.has(item.index),
                    weight: selected.get(item.index) ?? 0 })) };
        },
        dispose() { restore(); unhook(); selected.clear(); mesh = null; items = []; },
    };
}
