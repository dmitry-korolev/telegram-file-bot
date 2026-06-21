'use strict';

const assert = require('assert');

const { createQueuedTelegramSender } = require('../src/adapters/telegram/queued-sender');

async function runTests() {
  await testQueuedSenderRunsCallsInFifoOrderWithInterval();
  await testQueuedSenderDefaultsToShortInterval();
  await testQueuedSenderSharesQueueAcrossMessageAndPhoto();
}

async function testQueuedSenderRunsCallsInFifoOrderWithInterval() {
  const fakeClock = createFakeClock();
  const calls = [];
  const sender = createQueuedTelegramSender({
    sender: {
      async sendMessage(payload) {
        calls.push({ method: 'sendMessage', text: payload.text, at: fakeClock.now() });
        return { message_id: calls.length };
      }
    },
    intervalMs: 500,
    setTimeoutFn: fakeClock.setTimeoutFn,
    now: fakeClock.now
  });

  const first = sender.sendMessage({ text: 'first' });
  const second = sender.sendMessage({ text: 'second' });

  await flushMicrotasks();

  assert.deepStrictEqual(calls, [{ method: 'sendMessage', text: 'first', at: 0 }]);
  assert.strictEqual(fakeClock.timers.length, 1);
  assert.strictEqual(fakeClock.timers[0].ms, 500);

  fakeClock.runNextTimer();
  await second;

  assert.deepStrictEqual(calls, [
    { method: 'sendMessage', text: 'first', at: 0 },
    { method: 'sendMessage', text: 'second', at: 500 }
  ]);
  assert.deepStrictEqual(await first, { message_id: 1 });
}

async function testQueuedSenderSharesQueueAcrossMessageAndPhoto() {
  const fakeClock = createFakeClock();
  const calls = [];
  const sender = createQueuedTelegramSender({
    sender: {
      async sendMessage(payload) {
        calls.push({ method: 'sendMessage', value: payload.text, at: fakeClock.now() });
        return { message_id: 1 };
      },
      async sendPhoto(payload) {
        calls.push({ method: 'sendPhoto', value: payload.fileId, at: fakeClock.now() });
        return { message_id: 2 };
      }
    },
    intervalMs: 500,
    setTimeoutFn: fakeClock.setTimeoutFn,
    now: fakeClock.now
  });

  const message = sender.sendMessage({ text: 'queued text' });
  const photo = sender.sendPhoto({ fileId: 'photo-file-id' });

  await flushMicrotasks();
  fakeClock.runNextTimer();
  await Promise.all([message, photo]);

  assert.deepStrictEqual(calls, [
    { method: 'sendMessage', value: 'queued text', at: 0 },
    { method: 'sendPhoto', value: 'photo-file-id', at: 500 }
  ]);
}

async function testQueuedSenderDefaultsToShortInterval() {
  const fakeClock = createFakeClock();
  const calls = [];
  const sender = createQueuedTelegramSender({
    sender: {
      async sendMessage(payload) {
        calls.push({ text: payload.text, at: fakeClock.now() });
        return { message_id: calls.length };
      }
    },
    setTimeoutFn: fakeClock.setTimeoutFn,
    now: fakeClock.now
  });

  const first = sender.sendMessage({ text: 'first' });
  const second = sender.sendMessage({ text: 'second' });

  await flushMicrotasks();

  assert.strictEqual(fakeClock.timers[0].ms, 250);

  fakeClock.runNextTimer();
  await Promise.all([first, second]);

  assert.deepStrictEqual(calls, [
    { text: 'first', at: 0 },
    { text: 'second', at: 250 }
  ]);
}

function createFakeClock() {
  let currentTime = 0;
  const timers = [];

  return {
    timers,
    now: () => currentTime,
    setTimeoutFn(callback, ms) {
      timers.push({ callback, ms });
      return timers.length;
    },
    runNextTimer() {
      const timer = timers.shift();
      currentTime += timer.ms;
      timer.callback();
    }
  };
}

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

module.exports = {
  runTests
};
