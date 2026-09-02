const DEFAULT_SERVER_URL = 'https://192.168.1.39:8081';

function resolveServerUrl(env = process.env) {
    const configured = typeof env.AASC_DISPLAY_SERVER_URL === 'string'
        ? env.AASC_DISPLAY_SERVER_URL.trim()
        : '';
    return configured || DEFAULT_SERVER_URL;
}

function buildStartArgs(device, serverUrl) {
    return [
        '-s',
        device,
        'shell',
        'am',
        'start',
        '-n',
        'com.aasc.display/.MainActivity',
        '--es',
        'server_url',
        serverUrl
    ];
}

module.exports = {
    DEFAULT_SERVER_URL,
    resolveServerUrl,
    buildStartArgs
};
