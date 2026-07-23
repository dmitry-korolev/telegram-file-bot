'use strict';

const assert = require('assert');

const { extractMessageAuthor } = require('../src/domain/message-author');

function runTests() {
  testExtractsAuthorsFromShownCaptions();
  testUsesOnlyFirstCaptionLine();
  testAcceptsMultipleLeadingEmoji();
  testRejectsInvalidAuthorCaptions();
}

function testExtractsAuthorsFromShownCaptions() {
  const examples = [
    ['⭐ Dr Strange (VIP)\nLimitless — @Limitless_SCBot', 'Dr Strange'],
    ['👤 Boolean Availability (Member)\n🎩 @APCL_Official_Channel 🆕 🔥', 'Boolean Availability'],
    ['👤 Shy Pinscher (Member)\n🎩 @APCL_Official_Channel 🆕 🔥', 'Shy Pinscher'],
    ['👤 Straight Archive (Member)\n🎩 @APCL_Official_Channel 🆕 🔥', 'Straight Archive'],
    ['💎 Goblin Slayer (platinum)', 'Goblin Slayer']
  ];

  for (const [caption, expectedAuthor] of examples) {
    assert.strictEqual(extractMessageAuthor(caption), expectedAuthor);
  }
}

function testUsesOnlyFirstCaptionLine() {
  assert.strictEqual(
    extractMessageAuthor('⭐ Dr Strange (VIP)\nThis line (does not matter)'),
    'Dr Strange'
  );
  assert.strictEqual(
    extractMessageAuthor('⭐ Dr Strange\nSecond line (VIP)'),
    null
  );
}

function testAcceptsMultipleLeadingEmoji() {
  assert.strictEqual(
    extractMessageAuthor('⭐ 💎 Double Hero (VIP)'),
    'Double Hero'
  );
  assert.strictEqual(
    extractMessageAuthor('🧙🏽‍♂️ Magic Hero (Member)'),
    'Magic Hero'
  );
}

function testRejectsInvalidAuthorCaptions() {
  const invalidCaptions = [
    null,
    '',
    'Dr Strange (VIP)',
    '⭐ (VIP)',
    '⭐ Dr Strange VIP',
    '⭐ Dr Strange ()',
    '⭐ Dr Strange (VIP',
    '⭐ Dr Strange (VIP) trailing text'
  ];

  for (const caption of invalidCaptions) {
    assert.strictEqual(extractMessageAuthor(caption), null);
  }
}

module.exports = {
  runTests
};
