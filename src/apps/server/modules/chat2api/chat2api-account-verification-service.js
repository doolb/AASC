const { accountCredentialVersion } = require('./chat2api-data-store');
const { createDoubaoAccountVerifier, verificationAccountInfo } = require('./chat2api-doubao-account-verifier');

const failure = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });
const createChat2ApiAccountVerificationService = ({ dataStore, providerRegistry, verifier = createDoubaoAccountVerifier() } = {}) => {
  const pendingAccounts = new Set();
  const verifyAccount = async accountId => {
    if (pendingAccounts.has(accountId)) throw failure(409, 'verification_busy', '该账号正在验证，请稍后查看');
    pendingAccounts.add(accountId);
    try {
      const account = await dataStore.getAccount(accountId);
      if (!account) throw failure(404, 'account_not_found', '账号不存在');
      if (account.providerId !== 'doubaochat') throw failure(422, 'verification_unsupported', '当前仅支持豆包会话列表验证');
      const provider = await providerRegistry.getProvider(account.providerId);
      const expectedVersion = accountCredentialVersion(account);
      const result = await verifier.verify(account.credentials, provider);
      const saved = await dataStore.updateAccountVerification(accountId, expectedVersion, verificationAccountInfo(result));
      if (!saved) throw failure(409, 'verification_stale', '账号已删除或凭据已更换，请重新验证');
      return { account: saved, verification: { verified: result.verified === true, method: 'conversation-list',
        ...verificationAccountInfo(result) } };
    } finally { pendingAccounts.delete(accountId); }
  };
  return { verifyAccount };
};

module.exports = { createChat2ApiAccountVerificationService };
