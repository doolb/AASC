const DataSnapshot = require('./DataSnapshot');

class ControlStateData extends DataSnapshot {
    static defaults = {
        connections: [],
        displaySelections: {}
    };
}

module.exports = ControlStateData;
