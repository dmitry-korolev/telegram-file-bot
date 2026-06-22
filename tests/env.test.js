'use strict';

const assert = require('assert');

const { createConfig } = require('../src/config');
const { parseEnv } = require('../src/env');

function runTests() {
  testParseEnvReadsSimpleValues();
  testParseEnvUnquotesValues();
  testConfigParsesAuthorizedUserIds();
  testConfigParsesOutgoingMessageInterval();
  testConfigParsesDownloadRetryOptions();
}

function testParseEnvReadsSimpleValues() {
  const parsed = parseEnv(`
    NODE_ENV=development
    AUTHORIZED_USER_ID=123456789
    # ignored comment
    DOWNLOADS_DIR=./storage/downloads
  `);

  assert.strictEqual(parsed.NODE_ENV, 'development');
  assert.strictEqual(parsed.AUTHORIZED_USER_ID, '123456789');
  assert.strictEqual(parsed.DOWNLOADS_DIR, './storage/downloads');
}

function testConfigParsesAuthorizedUserIds() {
  const config = createConfig({
    AUTHORIZED_USER_IDS: '42, 77,not-a-number,88'
  });

  assert.deepStrictEqual(config.authorizedUserIds, [42, 77, 88]);
}

function testConfigParsesOutgoingMessageInterval() {
  const defaults = createConfig({});
  const configured = createConfig({
    TELEGRAM_OUTGOING_MESSAGE_INTERVAL_MS: '750'
  });

  assert.strictEqual(defaults.telegramOutgoingMessageIntervalMs, 250);
  assert.strictEqual(configured.telegramOutgoingMessageIntervalMs, 750);
}

function testConfigParsesDownloadRetryOptions() {
  const defaults = createConfig({});
  const configured = createConfig({
    DOWNLOAD_MAX_ATTEMPTS: '7',
    DOWNLOAD_RETRY_DELAY_MS: '250'
  });

  assert.strictEqual(defaults.downloadMaxAttempts, 20);
  assert.strictEqual(defaults.downloadRetryDelayMs, 1000);
  assert.strictEqual(configured.downloadMaxAttempts, 7);
  assert.strictEqual(configured.downloadRetryDelayMs, 250);
}

function testParseEnvUnquotesValues() {
  const parsed = parseEnv(`
    TELEGRAM_BOT_TOKEN="fake-token"
    SQLITE_DB_PATH='./storage/bot.sqlite'
  `);

  assert.strictEqual(parsed.TELEGRAM_BOT_TOKEN, 'fake-token');
  assert.strictEqual(parsed.SQLITE_DB_PATH, './storage/bot.sqlite');
}

module.exports = {
  runTests
};
