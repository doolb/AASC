const DataSnapshot = require('./DataSnapshot');

class ChatSessionData extends DataSnapshot {
    static defaults = {
        mode: 'group',
        privateTarget: null,
        privateSessionId: 'default',
        playOnControl: false,
        commandMode: true,
        sessions: {}
    };
}

module.exports = ChatSessionData;
