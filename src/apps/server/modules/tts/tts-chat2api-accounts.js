'use strict';

const { createChat2ApiDataStore } = require('../chat2api/chat2api-data-store');
const { createChat2ApiProviderRegistry } = require('../chat2api/chat2api-provider-registry');
const { parseCookies } = require('./qwen-chat-tts');

// 复用Chat2API共享数据存储，不启动代理。凭证只在本次请求内存中传给签名器。
function createTtsChat2ApiAccounts({ dataStore = createChat2ApiDataStore(),
    providerRegistry = createChat2ApiProviderRegistry({ dataStore }) } = {}) {
    return {
        async list() {
            try {
                const [accounts, provider] = await Promise.all([dataStore.listAccounts(), providerRegistry.getProvider('qwen')]);
                // 白名单投影，避免账号上未来增加的私有字段意外进入控制端。
                return accounts.filter(account => account.providerId === 'qwen').map(account => ({
                    accountId: account.accountId,
                    label: account.label || account.accountId,
                    available: account.enabled !== false && provider?.enabled !== false && Boolean(provider) && account.secretConfigured === true
                }));
            } catch (error) {
                throw new Error('Chat2API 千问账号列表读取失败');
            }
        },
        async resolveCredential(accountId) {
            if (typeof accountId !== 'string' || !accountId.trim()) throw new Error('请选择 Chat2API 国内千问账号');
            let account;
            let provider;
            try {
                [account, provider] = await Promise.all([dataStore.getAccount(accountId), providerRegistry.getProvider('qwen')]);
            } catch (error) {
                // 底层文件错误可能含私有目录或内容，不回显原始错误。
                throw new Error('Chat2API 千问账号读取失败');
            }
            if (!account) throw new Error('所选 Chat2API 千问账号已删除，请重新选择');
            if (account.providerId !== 'qwen') throw new Error('qwen-chat 仅支持 Chat2API 国内千问账号');
            if (account.enabled === false) throw new Error('所选 Chat2API 千问账号已停用');
            if (!provider || provider.enabled === false) throw new Error('Chat2API 国内千问 Provider 已停用');
            try {
                const cookie = typeof account.cookie === 'string' ? account.cookie.trim() : '';
                if (cookie.length > 16384 || /[\r\n]/u.test(cookie)) throw new Error('invalid cookie');
                const values = new Map(cookie ? parseCookies(cookie).map(item => [item.name, item.value]) : []);
                const ticket = account.credentials?.ticket;
                if (ticket !== undefined && (typeof ticket !== 'string' || /[;\r\n]/u.test(ticket) || ticket.length > 16384)) throw new Error('invalid ticket');
                // 账号登录更新可能先更新ticket，覆盖Cookie同名旧值以免继续使用过期票据。
                if (ticket?.trim()) values.set('tongyi_sso_ticket', ticket.trim());
                if (!values.get('tongyi_sso_ticket')) throw new Error('missing ticket');
                const credential = [...values].map(([name, value]) => `${name}=${value}`).join('; ');
                if (credential.length > 16384) throw new Error('oversized cookie');
                return credential;
            } catch (error) {
                throw new Error('所选 Chat2API 千问账号缺少有效登录凭证，请在账户管理中更新');
            }
        }
    };
}

module.exports = { createTtsChat2ApiAccounts };
