'use strict';

const assert = require('assert');

const {
  buildShownFilesMessage,
  buildQueueMessage,
  buildProcessingResponse,
  createShowNextFilesKeyboard,
  isCommandMessage
} = require('../src/domain/user-messages');

function runTests() {
  testCommandMessageDetection();
  testQueueMessageUsesSummaryOnly();
  testShowNextKeyboardTextChangesByContext();
  testShownFilesMessageUsesConfirmationText();
  testSingleDownloadedFileMessage();
  testMultipleFilesSummary();
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

function testSingleDownloadedFileMessage() {
  const response = buildProcessingResponse([
    {
      fileKind: 'document',
      fileName: 'report.pdf',
      status: 'downloaded'
    }
  ]);

  assert.strictEqual(response, 'Файл "report.pdf" получен и загружен.');
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
    'Обработка завершена: загружено - 1, добавлено в очередь - 2, пропущено как дубликаты - 1, ошибок - 1.'
  );
}

module.exports = {
  runTests
};
