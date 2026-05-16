const DataSnapshot = require('./DataSnapshot');

class ChatCommandsData extends DataSnapshot {
    static defaults = {
        commands: {}
    };
}

module.exports = ChatCommandsData;
