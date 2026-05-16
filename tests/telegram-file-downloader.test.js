'use strict';

const assert = require('assert');

const { sanitizeFileName } = require('../src/adapters/telegram/file-downloader');

function runTests() {
  testSanitizeFileNameKeepsSafeCharacters();
  testSanitizeFileNameReplacesUnsafeCharacters();
  testSanitizeFileNameRejectsDirectoryTraversalNames();
}

function testSanitizeFileNameKeepsSafeCharacters() {
  assert.strictEqual(sanitizeFileName('abc-123_DEF.txt'), 'abc-123_DEF.txt');
}

function testSanitizeFileNameReplacesUnsafeCharacters() {
  assert.strictEqual(sanitizeFileName('../weird id:42'), '.._weird_id_42');
}

function testSanitizeFileNameRejectsDirectoryTraversalNames() {
  assert.strictEqual(sanitizeFileName('..'), 'telegram-file');
}

module.exports = {
  runTests
};
