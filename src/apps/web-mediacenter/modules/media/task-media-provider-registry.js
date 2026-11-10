'use strict';

// 媒体源地区：仅允许国内与海外，未知值回退为 domestic。
const REGIONS = new Set(['domestic', 'overseas']);
// 媒体源能力：注册时过滤未知能力并去重。
const FEATURES = new Set(['home', 'search', 'resolveLink', 'related', 'stream', 'download']);

// 注册只在任务服务存活期间有效；媒体库配置独立持久化。
class TaskMediaProviderRegistry {
    constructor() { this.providers = new Map(); }
    register(owner, definition) {
        const id = String(definition?.id || '').trim();
        if (!/^[a-z][a-z0-9._-]{1,63}$/.test(id) || typeof definition.create !== 'function') throw new Error('任务媒体源 ID 或工厂无效');
        if (!owner || this.providers.has(id)) throw new Error('任务媒体源 ID 已注册');
        // 归一化地区与能力：地区缺失或非法时默认国内，能力去重且只保留受支持项。
        const region = REGIONS.has(definition.region) ? definition.region : 'domestic';
        const features = [...new Set((Array.isArray(definition.features) ? definition.features : []).filter(name => FEATURES.has(name)))];
        // defaultConfig 仅接受普通对象并浅拷贝，避免调用方后续修改影响注册表。
        const defaultConfig = definition.defaultConfig && typeof definition.defaultConfig === 'object' && !Array.isArray(definition.defaultConfig) ? { ...definition.defaultConfig } : {};
        const entry = { id, owner, name: String(definition.name || id).slice(0, 100), region, features, proxyDefault: definition.proxyDefault === true, defaultConfig, create: definition.create };
        this.providers.set(id, entry);
        return () => { if (this.providers.get(id) === entry) this.providers.delete(id); };
    }
    get(id) { return this.providers.get(id); }
    list() { return [...this.providers.values()].map(({ id, name, region, features, proxyDefault }) => ({ id, name, region, features, proxyDefault })); }
}
module.exports = { TaskMediaProviderRegistry };
