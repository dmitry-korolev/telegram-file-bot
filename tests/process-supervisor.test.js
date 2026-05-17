'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');

const { createRestartingProcessSupervisor, formatExitReason } = require('../src/application/process-supervisor');

function runTests() {
  testRestartsExitedProcessAfterDelay();
  testStopCancelsPendingRestart();
  testStopKillsRunningChild();
  testFormatsExitReason();
}

function testRestartsExitedProcessAfterDelay() {
  const children = [];
  const timers = [];
  const supervisor = createRestartingProcessSupervisor({
    command: 'node',
    args: ['bot.js'],
    restartDelayMs: 25,
    spawnProcess: createFakeSpawn(children),
    setRestartTimer: createFakeSetTimeout(timers),
    clearRestartTimer: createFakeClearTimeout(),
    logger: createSilentLogger()
  });

  supervisor.start();
  assert.strictEqual(children.length, 1);

  children[0].emit('exit', 1, null);
  assert.strictEqual(timers.length, 1);
  assert.strictEqual(timers[0].ms, 25);
  assert.strictEqual(children.length, 1);

  timers[0].fn();
  assert.strictEqual(children.length, 2);
}

function testStopCancelsPendingRestart() {
  const children = [];
  const timers = [];
  const clearedTimers = [];
  const supervisor = createRestartingProcessSupervisor({
    command: 'node',
    restartDelayMs: 25,
    spawnProcess: createFakeSpawn(children),
    setRestartTimer: createFakeSetTimeout(timers),
    clearRestartTimer(timer) {
      clearedTimers.push(timer);
    },
    logger: createSilentLogger()
  });

  supervisor.start();
  children[0].emit('exit', 1, null);
  supervisor.stop();

  assert.deepStrictEqual(clearedTimers, [timers[0]]);
}

function testStopKillsRunningChild() {
  const children = [];
  const supervisor = createRestartingProcessSupervisor({
    command: 'node',
    spawnProcess: createFakeSpawn(children),
    setRestartTimer: createFakeSetTimeout([]),
    clearRestartTimer: createFakeClearTimeout(),
    logger: createSilentLogger()
  });

  supervisor.start();
  supervisor.stop('SIGINT');

  assert.deepStrictEqual(children[0].killedWith, ['SIGINT']);
}

function testFormatsExitReason() {
  assert.strictEqual(formatExitReason(1, null), 'code 1');
  assert.strictEqual(formatExitReason(null, 'SIGTERM'), 'signal SIGTERM');
}

function createFakeSpawn(children) {
  return function fakeSpawn() {
    const child = new EventEmitter();
    child.killedWith = [];
    child.kill = function kill(signal) {
      child.killedWith.push(signal);
    };
    children.push(child);
    return child;
  };
}

function createFakeSetTimeout(timers) {
  return function fakeSetTimeout(fn, ms) {
    const timer = { fn, ms };
    timers.push(timer);
    return timer;
  };
}

function createFakeClearTimeout() {
  return function fakeClearTimeout() {};
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
