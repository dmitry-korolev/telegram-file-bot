'use strict';

function createBaseMessage(overrides) {
  const baseMessage = {
    message_id: 101,
    chat: { id: 5001 },
    from: { id: 42 }
  };

  return Object.assign({}, baseMessage, overrides || {});
}

module.exports = {
  createBaseMessage
};
