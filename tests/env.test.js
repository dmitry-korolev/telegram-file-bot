'use strict';

const assert = require('assert');

const { createConfig } = require('../src/config');
const { parseEnv } = require('../src/env');

function runTests() {
  testParseEnvReadsSimpleValues();
  testParseEnvUnquotesValues();
  testConfigParsesAuthorizedUserIds();
  testConfigParsesMediaGroupResponseDelay();
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

function testConfigParsesMediaGroupResponseDelay() {
  const config = createConfig({
    AUTHORIZED_USER_IDS: '42',
    MEDIA_GROUP_RESPONSE_DELAY_MS: '1500'
  });

  assert.strictEqual(config.mediaGroupResponseDelayMs, 1500);
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
