'use strict';

const assert = require('assert');

const { createTelegramPollingLoop } = require('../src/application/polling');

async function runTests() {
  await testOffsetAdvancesAfterSuccessfulProcessing();
  await testOffsetDoesNotAdvancePastFailedUpdate();
}

async function testOffsetAdvancesAfterSuccessfulProcessing() {
  const calls = [];
  let requestCount = 0;
  const telegramClient = {
    async getUpdates(params) {
      calls.push(params);
      requestCount += 1;

      if (requestCount === 1) {
        return [
          { update_id: 10, message: { text: 'a' } },
          { update_id: 11, message: { text: 'b' } }
        ];
      }

      loop.stop();
      return [];
    }
  };
  const updateHandler = {
    async handleUpdate() {
      return {
        accepted: true,
        reason: 'ok',
        files: [],
        deleteMessageCalled: false,
        sendMessageCalled: false
      };
    }
  };
  const loop = createTelegramPollingLoop({
    telegramClient,
    updateHandler,
    timeoutSeconds: 1,
    retryDelayMs: 1,
    logger: createSilentLogger()
  });

  await loop.start();

  assert.deepStrictEqual(
    calls.map((call) => call.offset),
    [0, 12]
  );
}

async function testOffsetDoesNotAdvancePastFailedUpdate() {
  const calls = [];
  let requestCount = 0;
  const telegramClient = {
    async getUpdates(params) {
      calls.push(params);
      requestCount += 1;

      if (requestCount === 1) {
        return [
          { update_id: 20, message: { text: 'ok' } },
          { update_id: 21, message: { text: 'fail' } }
        ];
      }

      loop.stop();
      return [];
    }
  };
  const updateHandler = {
    async handleUpdate(update) {
      if (update.update_id === 21) {
        throw new Error('boom');
      }

      return {
        accepted: true,
        reason: 'ok',
        files: [],
        deleteMessageCalled: false,
        sendMessageCalled: false
      };
    }
  };
  const loop = createTelegramPollingLoop({
    telegramClient,
    updateHandler,
    timeoutSeconds: 1,
    retryDelayMs: 1,
    logger: createSilentLogger()
  });

  await loop.start();

  assert.deepStrictEqual(
    calls.map((call) => call.offset),
    [0, 21]
  );
}

function createSilentLogger() {
  return {
    log() {},
    error() {}
  };
}

module.exports = {
  runTests
};
