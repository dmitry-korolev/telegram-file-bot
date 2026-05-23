'use strict';

const BOT_COMMANDS = [
  {
    command: 'show_queue',
    description: 'Показать очередь'
  },
  {
    command: 'queue',
    description: 'Вернуть файл в очередь'
  },
  {
    command: 'show_archive',
    description: 'Показать архив'
  },
  {
    command: 'archive',
    description: 'Переместить файл в архив'
  },
  {
    command: 'stats',
    description: 'Показать статистику'
  },
  {
    command: 'stats_image',
    description: 'Статистика картинкой'
  },
  {
    command: 'clear_queue',
    description: 'Очистить очередь'
  }
];

const BOT_COMMAND_SCOPE_PRIVATE_CHATS = {
  type: 'all_private_chats'
};

module.exports = {
  BOT_COMMANDS,
  BOT_COMMAND_SCOPE_PRIVATE_CHATS
};
