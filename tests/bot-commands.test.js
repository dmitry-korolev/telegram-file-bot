'use strict';

const assert = require('assert');

const { BOT_COMMANDS, BOT_COMMAND_SCOPE_PRIVATE_CHATS } = require('../src/domain/bot-commands');

function runTests() {
  testBotCommandsIncludePublicCommands();
  testBotCommandsUsePrivateChatScope();
}

function testBotCommandsIncludePublicCommands() {
  assert.deepStrictEqual(
    BOT_COMMANDS.map((command) => command.command),
    [
      'show_queue',
      'search_queue',
      'queue',
      'retry',
      'show_archive',
      'search_archive',
      'archive',
      'stats',
      'stats_image',
      'clear_queue'
    ]
  );
  assert.strictEqual(BOT_COMMANDS.every((command) => typeof command.description === 'string' && command.description.length > 0), true);
  assert.strictEqual(
    BOT_COMMANDS.find((command) => command.command === 'search_queue').description,
    'Найти файл или автора в очереди'
  );
  assert.strictEqual(
    BOT_COMMANDS.find((command) => command.command === 'search_archive').description,
    'Найти файл или автора в архиве'
  );
}

function testBotCommandsUsePrivateChatScope() {
  assert.deepStrictEqual(BOT_COMMAND_SCOPE_PRIVATE_CHATS, {
    type: 'all_private_chats'
  });
}

module.exports = {
  runTests
};
