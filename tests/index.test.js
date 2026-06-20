'use strict';

const assert = require('assert');

const { registerBotCommands } = require('../src/index');

async function runTests() {
  await testRegisterBotCommandsDoesNotThrowOnApiFailure();
}

async function testRegisterBotCommandsDoesNotThrowOnApiFailure() {
  const errors = [];
  const telegramClient = {
    async setMyCommands() {
      throw new Error('network unavailable');
    }
  };
  const logger = {
    error(message, fields) {
      errors.push({ message, fields });
    }
  };

  await registerBotCommands(telegramClient, logger);

  assert.strictEqual(errors.length, 1);
  assert.strictEqual(errors[0].message, 'bot command registration failed');
  assert.strictEqual(errors[0].fields.error.message, 'network unavailable');
}

module.exports = {
  runTests
};
