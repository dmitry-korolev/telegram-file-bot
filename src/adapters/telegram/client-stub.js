'use strict';

class TelegramClientStub {
  getFile() {
    throw new Error('Telegram API is not connected in stage 1.');
  }
}

module.exports = {
  TelegramClientStub
};
