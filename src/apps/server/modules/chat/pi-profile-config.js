'use strict';

const { canonicalJson, hash } = require('../aasc/shared-update-manifest');

function usesPi(profiles) { return profiles.some(profile => profile.mode === 'agent' && (profile.backend || 'pi') === 'pi'); }

/** 配置作为草稿准备，依赖成功且权威指纹未变化后才提交，取消不需要写磁盘回滚。 */
class PiProfileConfig {
    constructor(options) {
        this.chat = options.chat;
        this.config = options.config;
        this.dependencies = options.dependencies;
        this.broadcast = options.broadcast || (() => {});
        this.isControl = options.isControl || (() => true);
        this.state = { phase: 'idle' };
        this.preparing = null;
    }

    snapshot() {
        const profiles = this.chat.getProfiles();
        const activeProfile = this.chat.getActiveProfile();
        return { type: 'chatProfilesConfig', profiles, activeProfile,
            revision: hash(canonicalJson({ profiles, activeProfile })), dependency: this.state };
    }

    async prepare() {
        if (this.preparing) return this.preparing;
        this.preparing = (async () => {
            try {
                const id = this.dependencies.piDependencyId();
                await this.dependencies.ensure([id], progress => {
                    this.state = { phase: 'preparing', percent: progress.percent, message: progress.message || '正在下载 PiAgent 依赖' };
                    this.broadcast({ type: 'piDependencyStatus', ...this.state });
                });
                this.state = { phase: 'ready', percent: 100 };
                this.broadcast({ type: 'piDependencyStatus', ...this.state });
                return this.dependencies.moduleRoot(id);
            } catch (error) {
                this.state = { phase: 'error', message: error.message };
                this.broadcast({ type: 'piDependencyStatus', ...this.state });
                throw error;
            }
        })();
        try { return await this.preparing; }
        finally { this.preparing = null; }
    }

    async startup() {
        if (!usesPi(this.chat.getProfiles().filter(profile => profile.name === this.chat.getActiveProfile()))) return;
        await this.prepare();
    }

    async update(data, internal = {}) {
        const before = this.snapshot();
        const expected = data.revision || before.revision;
        try {
            if (data.revision && data.revision !== before.revision) throw new Error('配置已被其他控制端修改，请重新编辑');
            const raw = data.type === 'switchProfile' || data.type === 'chatProfileSwitch' ? before.profiles : data.profiles;
            if (!Array.isArray(raw) || raw.some(profile => !profile || typeof profile !== 'object' || Array.isArray(profile))) throw new Error('LLM配置必须为对象列表');
            const profiles = raw.map(profile => this.chat.normalizeLlmProfile(profile));
            const names = profiles.map(profile => String(profile.name || '').trim());
            if (names.some(name => !name) || new Set(names).size !== names.length) throw new Error('配置名称为空或重复');
            profiles.forEach((profile, index) => { profile.name = names[index]; });
            const activeProfile = data.name || (names.includes(before.activeProfile) ? before.activeProfile : names[0] || 'default');
            if (data.name && !names.includes(data.name)) throw new Error(`未找到配置：${data.name}`);
            // 未使用的Pi配置不触发下载；正在保存、变更或选中的Pi配置才需要准备。
            const needed = profiles.filter(profile => profile.name === data.profileName || profile.name === activeProfile ||
                canonicalJson(profile) !== canonicalJson(before.profiles.find(previous => previous.name === profile.name)));
            if (usesPi(needed)) {
                const ready = await this.dependencies.isReady(this.dependencies.piDependencyId());
                if (!ready && data.downloadConfirmed !== true) return { ...before, status: 'downloadRequired',
                    message: '该配置需要下载 PiAgent 依赖。是否下载并保存？取消将恢复原配置。' };
                await this.prepare();
            }
            if (this.snapshot().revision !== expected) throw new Error('下载期间配置已发生变化，请重新编辑');
            const selected = profiles.find(profile => profile.name === activeProfile) || {};
            const stored = { ...this.config.get('chat', {}), ...this.chat.pickGlobalChatConfig(this.chat.getConfig()),
                llmProfiles: profiles, activeProfile,
                ...Object.fromEntries(['apiUrl', 'model', 'apiKey', 'maxTokens', 'temperature', 'contextCount', 'promptFormat', 'mode', 'backend']
                    .filter(key => selected[key] !== undefined).map(key => [key, selected[key]])),
                ...internal.chatOverrides };
            if (this.config.set('chat', stored) === false) throw new Error('配置持久化失败');
            this.chat.setProfiles(profiles);
            this.chat.switchProfile(activeProfile);
            const authoritative = this.snapshot();
            this.broadcast(authoritative);
            this.broadcast({ type: 'profileSwitched', activeProfile, config: { apiUrl: selected.apiUrl, model: selected.model } });
            return { ...authoritative, status: 'success', config: { apiUrl: selected.apiUrl, model: selected.model } };
        } catch (error) { return { ...this.snapshot(), status: 'error', message: error.message }; }
    }

    /** 模型快选只改当前普通 LLM 的模型名，复用配置修订检查和一次持久化写入。 */
    async updateActiveModel(model, modelTierSelection) {
        const before = this.snapshot();
        const active = before.profiles.find(profile => profile.name === before.activeProfile);
        if (!active || active.mode === 'agent') throw new Error('当前配置不是普通 LLM');
        const profiles = before.profiles.map(profile => profile.name === active.name
            ? { ...profile, model } : profile);
        const result = await this.update({ type: 'chatProfilesSave', profiles,
            profileName: active.name, revision: before.revision },
        { chatOverrides: { modelTierSelection } });
        if (result.status !== 'success') throw new Error(result.message || '模型配置保存失败');
        return result;
    }

    async handle(ws, data) {
        if (!this.isControl(ws)) return;
        const result = data.type === 'getChatProfilesConfig' ? this.snapshot() : await this.update(data);
        if (ws.readyState === 1) ws.send(JSON.stringify({ ...result, requestId: data.requestId }));
    }
}

module.exports = { PiProfileConfig, usesPi };
