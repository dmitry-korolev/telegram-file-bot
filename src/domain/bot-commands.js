'use strict';

const BOT_COMMANDS = [
  {
    command: 'show_queue',
    description: 'Показать очередь'
  },
  {
    command: 'search_queue',
    description: 'Найти файл или автора в очереди'
  },
  {
    command: 'queue',
    description: 'Вернуть файл в очередь'
  },
  {
    command: 'retry',
    description: 'Повторить обработку сообщения'
  },
  {
    command: 'show_archive',
    description: 'Показать архив'
  },
  {
    command: 'search_archive',
    description: 'Найти файл или автора в архиве'
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
