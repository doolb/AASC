'use strict';

const { createSignalEvent } = require('../contracts/signal-event');

class InputNormalizer {
  normalize(rawInput) {
    return createSignalEvent(rawInput || {});
  }
}

module.exports = {
  InputNormalizer
};
