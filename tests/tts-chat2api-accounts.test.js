'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createChat2ApiDataStore } = require('../src/apps/server/modules/chat2api/chat2api-data-store');
const { createTtsChat2ApiAccounts } = require('../src/apps/server/modules/tts/tts-chat2api-accounts');

async function fixture(t) {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-tts-chat2api-'));
    t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
    const dataStore = createChat2ApiDataStore({ rootDir });
    return { dataStore, accounts: createTtsChat2ApiAccounts({ dataStore }) };
}

test('真实共享存储列表只返回国内账号白名单字段，无需启动代理', async t => {
    const { dataStore, accounts } = await fixture(t);
    await dataStore.saveAccount({ accountId: 'domestic', providerId: 'qwen', label: '<千问>', credentials: { ticket: 'private-ticket' }, cookie: 'tongyi_sso_ticket=private-cookie', privateExtra: 'hidden' });
    await dataStore.saveAccount({ accountId: 'disabled', providerId: 'qwen', enabled: false, credentials: { ticket: 'disabled-ticket' } });
    await dataStore.saveAccount({ accountId: 'empty', providerId: 'qwen' });
    await dataStore.saveAccount({ accountId: 'international', providerId: 'qwen-ai', credentials: { token: 'private-token' } });
    assert.deepEqual(await accounts.list(), [
        { accountId: 'domestic', label: '<千问>', available: true },
        { accountId: 'disabled', label: 'disabled', available: false },
        { accountId: 'empty', label: 'empty', available: false }
    ]);
    await dataStore.writeCollection('providers', [{ id: 'qwen', enabled: false }]);
    assert.ok((await accounts.list()).every(account => !account.available));
});

test('ticket覆盖同名旧Cookie并保留其他Cookie；更新、删除、停用与错误Provider实时生效', async t => {
    const { dataStore, accounts } = await fixture(t);
    await dataStore.saveAccount({ accountId: 'a', providerId: 'qwen', cookie: 'Cookie: tongyi_sso_ticket=old; extra=ok', credentials: { ticket: 'new' } });
    assert.equal(await accounts.resolveCredential('a'), 'tongyi_sso_ticket=new; extra=ok');
    await dataStore.updateAccount('a', { credentials: { ticket: 'latest' } });
    assert.equal(await accounts.resolveCredential('a'), 'tongyi_sso_ticket=latest; extra=ok');
    await dataStore.updateAccount('a', { credentials: {}, cookie: 'tongyi_sso_ticket=cookie-only' });
    assert.equal(await accounts.resolveCredential('a'), 'tongyi_sso_ticket=cookie-only');
    await dataStore.updateAccount('a', { enabled: false });
    await assert.rejects(accounts.resolveCredential('a'), /账号已停用/u);
    await dataStore.deleteAccount('a');
    await assert.rejects(accounts.resolveCredential('a'), /已删除/u);
    await dataStore.saveAccount({ accountId: 'international', providerId: 'qwen-ai', credentials: { token: 'secret' } });
    await assert.rejects(accounts.resolveCredential('international'), /仅支持/u);
    await assert.rejects(accounts.resolveCredential(''), /请选择/u);
});

test('Provider停用、凭证缺失/坏格式和底层错误均脱敏且不修改账号', async t => {
    const { dataStore, accounts } = await fixture(t);
    const invalid = [ {}, { cookie: 'extra=ok' }, { credentials: { ticket: 'private;injection=1' } },
        { cookie: 'tongyi_sso_ticket=private\r\nvalue' }, { credentials: { ticket: 123 } }, { cookie: 'x'.repeat(16385) } ];
    for (const fields of invalid) {
        await dataStore.saveAccount({ accountId: 'a', providerId: 'qwen', ...fields });
        const before = await dataStore.getAccount('a');
        await assert.rejects(accounts.resolveCredential('a'), error => /有效登录凭证/u.test(error.message) && !error.message.includes('private'));
        assert.deepEqual(await dataStore.getAccount('a'), before);
    }
    await dataStore.saveAccount({ accountId: 'a', providerId: 'qwen', credentials: { ticket: 'valid' } });
    await dataStore.writeCollection('providers', [{ id: 'qwen', enabled: false }]);
    await assert.rejects(accounts.resolveCredential('a'), /Provider 已停用/u);
    const broken = createTtsChat2ApiAccounts({ dataStore: { listAccounts: async () => { throw new Error('private-data'); }, getAccount: async () => { throw new Error('private-data'); } },
        providerRegistry: { getProvider: async () => ({ enabled: true }) } });
    await assert.rejects(broken.list(), error => error.message === 'Chat2API 千问账号列表读取失败');
    await assert.rejects(broken.resolveCredential('a'), error => error.message === 'Chat2API 千问账号读取失败');
});
