'use strict';

const assert = require('assert');

const {
  buildShownFilesMessage,
  buildQueueMessage,
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
  testStatsMessage();
  testShowNextKeyboardTextChangesByContext();
  testShownFilesMessageUsesConfirmationText();
  testSingleDownloadedFileMessage();
  testMultipleFilesSummary();
}

function testStatsMessage() {
  const response = buildStatsMessage({
    totalFiles: 4,
    totalKnownSize: 38 * 1024 * 1024,
    activeQueueFiles: 1,
    activeQueueKnownSize: 25 * 1024 * 1024,
    downloadedFiles: 1,
    downloadConfirmedFiles: 1,
    duplicateFiles: 0,
    failedFiles: 1,
    documentFiles: 2,
    photoFiles: 1,
    videoFiles: 1,
    unknownSizeFiles: 1
  });

  assert.strictEqual(response.includes('Всего файлов: 4'), true);
  assert.strictEqual(response.includes('Активная очередь: 1 файлов, 25.0 МБ'), true);
  assert.strictEqual(response.includes('Ошибок: 1'), true);
}

function testCommandMessageDetection() {
  assert.strictEqual(isCommandMessage({ text: '/queue' }), true);
  assert.strictEqual(isCommandMessage({ text: ' /clear_queue' }), true);
  assert.strictEqual(isCommandMessage({ text: 'hello' }), false);
  assert.strictEqual(isCommandMessage({ caption: '/queue' }), false);
}

function testShowNextKeyboardTextChangesByContext() {
  assert.strictEqual(
    createShowNextFilesKeyboard().inline_keyboard[0][0].text,
    'Показать следующие вложения'
  );
  assert.strictEqual(
    createShowNextFilesKeyboard({ confirmAndShowNext: true }).inline_keyboard[0][0].text,
    'Подтвердить скачивание и показать следующие'
  );
  assert.strictEqual(
    createShowNextFilesKeyboard({ confirmOnly: true }).inline_keyboard[0][0].text,
    'Подтвердить скачивание'
  );
}

function testShownFilesMessageUsesConfirmationText() {
  assert.strictEqual(
    buildShownFilesMessage(10, 2),
    'Показано вложений: 10. Скачайте их в Telegram. После этого нажмите "Подтвердить скачивание и показать следующие", чтобы подтвердить скачивание и получить следующую пачку. Осталось в очереди: 2.'
  );
  assert.strictEqual(
    buildShownFilesMessage(2, 0),
    'Показано вложений: 2. Скачайте их в Telegram. После этого нажмите "Подтвердить скачивание", чтобы завершить очередь. Осталось в очереди: 0.'
  );
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
