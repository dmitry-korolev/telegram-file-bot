'use strict';

const assert = require('assert');

const {
  buildArchiveConfirmedMessage,
  buildArchiveFileNotFoundMessage,
  buildArchiveReplyRequiredMessage,
  buildArchiveSummaryMessage,
  buildShownArchiveFilesMessage,
  buildShownFilesMessage,
  buildQueueMessage,
  buildQueueFileNotFoundMessage,
  buildQueueReplyRequiredMessage,
  buildQueueReturnConfirmedMessage,
  buildQueueSummaryMessage,
  buildProcessingResponse,
  buildStatsMessage,
  createShowNextFilesKeyboard,
  isCommandMessage
} = require('../src/domain/user-messages');

function runTests() {
  testCommandMessageDetection();
  testQueueMessageUsesSummaryOnly();
  testQueueSummaryMessageUsesAggregate();
  testArchiveSummaryMessageUsesAggregate();
  testStatsMessage();
  testShowNextKeyboardIncludesQueueAndSizeActions();
  testShowNextKeyboardCanUseCustomCallbacks();
  testShowNextKeyboardCanHideSizeActions();
  testShownFilesMessageMarksFilesDownloaded();
  testArchiveMessages();
  testQueueReturnMessages();
  testSingleDownloadedFileMessage();
  testMultipleFilesSummary();
}

function testStatsMessage() {
  const response = buildStatsMessage({
    totalFiles: 4,
    totalKnownSize: 38 * 1024 * 1024,
    databaseSizeBytes: 128 * 1024,
    activeQueueFiles: 1,
    activeQueueKnownSize: 25 * 1024 * 1024,
    downloadedFiles: 1,
    downloadedKnownSize: 10 * 1024 * 1024,
    downloadConfirmedFiles: 1,
    duplicateFiles: 0,
    failedFiles: 1,
    documentFiles: 2,
    photoFiles: 1,
    videoFiles: 1,
    unknownSizeFiles: 1
  });

  assert.strictEqual(response.includes('Всего файлов: 4'), true);
  assert.strictEqual(response.includes('Хранилище:'), true);
  assert.strictEqual(response.includes('Обработка:'), true);
  assert.strictEqual(response.includes('Очередь:'), true);
  assert.strictEqual(response.includes('Типы вложений:'), true);
  assert.strictEqual(response.includes('Размер БД: 128 КБ'), true);
  assert.strictEqual(response.includes('Скачано автоматически: 1 файлов, 10.0 МБ'), true);
  assert.strictEqual(response.includes('Активная очередь: 1 файлов, 25.0 МБ'), true);
  assert.strictEqual(response.includes('Отсеяно дубликатов: 0'), true);
  assert.strictEqual(response.includes('Ошибок: 1'), true);
}

function testCommandMessageDetection() {
  assert.strictEqual(isCommandMessage({ text: '/queue' }), true);
  assert.strictEqual(isCommandMessage({ text: ' /clear_queue' }), true);
  assert.strictEqual(isCommandMessage({ text: 'hello' }), false);
  assert.strictEqual(isCommandMessage({ caption: '/queue' }), false);
}

function testShowNextKeyboardIncludesQueueAndSizeActions() {
  const keyboard = createShowNextFilesKeyboard().inline_keyboard;

  assert.strictEqual(
    keyboard[0][0].text,
    'Показать следующие вложения'
  );
  assert.strictEqual(
    keyboard[1][0].callback_data,
    'show_largest_files'
  );
  assert.strictEqual(
    keyboard[1][1].callback_data,
    'show_smallest_files'
  );
}

function testShowNextKeyboardCanHideSizeActions() {
  assert.strictEqual(
    createShowNextFilesKeyboard({ includeSizeButtons: false }).inline_keyboard.length,
    1
  );
}

function testShowNextKeyboardCanUseCustomCallbacks() {
  const keyboard = createShowNextFilesKeyboard({
    callbackData: {
      showNext: 'archive_next',
      showLargest: 'archive_largest',
      showSmallest: 'archive_smallest'
    }
  }).inline_keyboard;

  assert.strictEqual(keyboard[0][0].callback_data, 'archive_next');
  assert.strictEqual(keyboard[1][0].callback_data, 'archive_largest');
  assert.strictEqual(keyboard[1][1].callback_data, 'archive_smallest');
}

function testShownFilesMessageMarksFilesDownloaded() {
  assert.strictEqual(
    buildShownFilesMessage(10, 2),
    'Показано вложений: 10. Они отмечены как скачанные. Осталось в очереди: 2.'
  );
  assert.strictEqual(
    buildShownFilesMessage(2, 0),
    'Показано вложений: 2. Они отмечены как скачанные. Осталось в очереди: 0.'
  );
}

function testArchiveMessages() {
  assert.strictEqual(
    buildShownArchiveFilesMessage(2, 0),
    'Показано вложений из архива: 2. Они отмечены как скачанные. Осталось в архиве: 0.'
  );
  assert.strictEqual(
    buildShownArchiveFilesMessage(0, 0),
    'Больше файлов в архиве нет.'
  );
  assert.strictEqual(
    buildArchiveReplyRequiredMessage(),
    'Отправьте /archive в ответ на медиа, которое бот прислал из очереди или архива.'
  );
  assert.strictEqual(buildArchiveFileNotFoundMessage(), 'Не удалось найти файл для этого сообщения.');
  assert.strictEqual(buildArchiveConfirmedMessage(), 'Файл перемещен в архив.');
}

function testQueueReturnMessages() {
  assert.strictEqual(
    buildQueueReplyRequiredMessage(),
    'Отправьте /queue в ответ на медиа, которое бот прислал из очереди или архива.'
  );
  assert.strictEqual(buildQueueFileNotFoundMessage(), 'Не удалось найти файл для этого сообщения.');
  assert.strictEqual(buildQueueReturnConfirmedMessage(), 'Файл возвращен в очередь.');
}

function testQueueMessageUsesSummaryOnly() {
  const response = buildQueueMessage([
    {
      file_name: 'first.bin',
      file_size: 25 * 1024 * 1024
    },
    {
      file_name: 'second.bin',
      file_size: 5 * 1024 * 1024
    },
    {
      file_name: 'unknown.bin',
      file_size: null
    }
  ]);

  assert.strictEqual(response, 'В очереди файлов: 3. Суммарный объем: 30.0 МБ, файлов с неизвестным размером: 1.');
  assert.strictEqual(response.includes('first.bin'), false);
  assert.strictEqual(response.includes('second.bin'), false);
}

function testQueueSummaryMessageUsesAggregate() {
  const response = buildQueueSummaryMessage({
    fileCount: 703,
    totalKnownSize: 120795.4 * 1024 * 1024,
    unknownSizeFiles: 0
  });

  assert.strictEqual(response, 'В очереди файлов: 703. Суммарный объем: 120795.4 МБ.');
}

function testArchiveSummaryMessageUsesAggregate() {
  assert.strictEqual(
    buildArchiveSummaryMessage({
      fileCount: 2,
      totalKnownSize: 30 * 1024 * 1024,
      unknownSizeFiles: 0
    }),
    'В архиве файлов: 2. Суммарный объем: 30.0 МБ.'
  );
  assert.strictEqual(buildArchiveSummaryMessage({ fileCount: 0 }), 'В архиве нет файлов.');
}

function testSingleDownloadedFileMessage() {
  const response = buildProcessingResponse([
    {
      fileKind: 'document',
      fileName: 'report.pdf',
      status: 'downloaded'
    }
  ]);

  assert.strictEqual(
    response,
    'Файл "report.pdf" скачан.'
  );
}

function testMultipleFilesSummary() {
  const response = buildProcessingResponse([
    { status: 'downloaded' },
    { status: 'pending_manual_download' },
    { status: 'pending_size_unknown' },
    { status: 'duplicate_skipped' },
    { status: 'download_failed' }
  ]);

  assert.strictEqual(
    response,
    'Итог: скачано 1, в очереди 2, дубликатов 1, ошибок 1.'
  );
}

module.exports = {
  runTests
};
