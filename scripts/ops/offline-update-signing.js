'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PRIVATE_KEY_ENV = 'AASC_OFFLINE_UPDATE_PRIVATE_KEY';
const PUBLIC_KEY_ENV = 'AASC_OFFLINE_UPDATE_PUBLIC_KEY';
const PRIVATE_KEY_FILE = 'offline-update-private.pem';
const PUBLIC_KEY_FILE = 'offline-update-public.pem';

function resolveOfflineUpdateKeyPaths(options = {}) {
    const homeDir = path.resolve(options.homeDir || os.homedir());
    const defaultDirectory = path.join(homeDir, '.config', 'aasc-user');
    return {
        privateKeyPath: path.resolve(
            options.privateKeyPath || process.env[PRIVATE_KEY_ENV] ||
            path.join(defaultDirectory, PRIVATE_KEY_FILE)
        ),
        publicKeyPath: path.resolve(
            options.publicKeyPath || process.env[PUBLIC_KEY_ENV] ||
            path.join(defaultDirectory, PUBLIC_KEY_FILE)
        )
    };
}

function parseRsaPrivateKey(privateKeyPem) {
    let privateKey;
    try {
        privateKey = crypto.createPrivateKey(privateKeyPem);
    } catch (error) {
        throw new Error(`Offline 更新私钥 PEM 无效: ${error.message}`, { cause: error });
    }
    if (privateKey.asymmetricKeyType !== 'rsa') {
        throw new Error('Offline 更新签名仅支持 RSA 私钥');
    }
    return privateKey;
}

function parseRsaPublicKey(publicKeyPem) {
    let publicKey;
    try {
        publicKey = crypto.createPublicKey(publicKeyPem);
    } catch (error) {
        throw new Error(`Offline 更新公钥 PEM 无效: ${error.message}`, { cause: error });
    }
    if (publicKey.asymmetricKeyType !== 'rsa') {
        throw new Error('Offline 更新验签仅支持 RSA 公钥');
    }
    return publicKey;
}

function assertKeyPairMatches(privateKey, publicKey) {
    const derivedPublicKey = crypto.createPublicKey(privateKey)
        .export({ type: 'spki', format: 'der' });
    const configuredPublicKey = publicKey.export({ type: 'spki', format: 'der' });
    if (!derivedPublicKey.equals(configuredPublicKey)) {
        throw new Error('Offline 更新公钥与私钥不匹配');
    }
}

async function readKeyFile(filePath, label, options = {}) {
    let stat;
    try {
        stat = await fs.promises.lstat(filePath);
    } catch (error) {
        if (error.code === 'ENOENT') throw new Error(`${label}文件不存在: ${filePath}`);
        throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`${label}文件不能是符号链接: ${filePath}`);
    if (!stat.isFile()) throw new Error(`${label}路径必须是普通文件: ${filePath}`);
    if (options.privateKey && process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
        throw new Error('Offline 更新私钥文件权限过宽；请设置为仅当前用户可读');
    }
    return fs.promises.readFile(filePath, 'utf8');
}

async function loadOfflineUpdateKeyPair(options = {}) {
    const injectedPrivatePem = options.privateKeyPem;
    const paths = resolveOfflineUpdateKeyPaths(options);
    const privateKeyPem = injectedPrivatePem || await readKeyFile(
        paths.privateKeyPath,
        'Offline 更新私钥',
        { privateKey: true }
    );
    const privateKey = parseRsaPrivateKey(privateKeyPem);
    const derivedPublicKeyPem = crypto.createPublicKey(privateKey)
        .export({ type: 'spki', format: 'pem' });
    const publicKeyPem = options.publicKeyPem || (injectedPrivatePem
        ? derivedPublicKeyPem
        : await readKeyFile(paths.publicKeyPath, 'Offline 更新公钥'));
    const publicKey = parseRsaPublicKey(publicKeyPem);
    assertKeyPairMatches(privateKey, publicKey);
    return {
        privateKeyPem,
        publicKeyPem,
        privateKeyPath: injectedPrivatePem ? null : paths.privateKeyPath,
        publicKeyPath: options.publicKeyPem || injectedPrivatePem ? null : paths.publicKeyPath
    };
}

async function loadOfflineUpdatePublicKey(options = {}) {
    if (options.publicKeyPem) {
        parseRsaPublicKey(options.publicKeyPem);
        return { publicKeyPem: options.publicKeyPem, publicKeyPath: null };
    }
    const paths = resolveOfflineUpdateKeyPaths(options);
    let publicKeyPem;
    try {
        publicKeyPem = await readKeyFile(paths.publicKeyPath, 'Offline 更新公钥');
    } catch (error) {
        if (options.required !== false || !error.message.startsWith('Offline 更新公钥文件不存在:')) {
            throw error;
        }
        return null;
    }
    parseRsaPublicKey(publicKeyPem);
    return { publicKeyPem, publicKeyPath: paths.publicKeyPath };
}

module.exports = {
    PRIVATE_KEY_ENV,
    PUBLIC_KEY_ENV,
    loadOfflineUpdateKeyPair,
    loadOfflineUpdatePublicKey,
    resolveOfflineUpdateKeyPaths
};
