'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createTelegramFileDownloader, sanitizeFileName } = require('../src/adapters/telegram/file-downloader');

async function runTests() {
  testSanitizeFileNameKeepsSafeCharacters();
  testSanitizeFileNameReplacesUnsafeCharacters();
  testSanitizeFileNameRejectsDirectoryTraversalNames();
  await testDownloadUsesOriginalFileName();
  await testDownloadAddsFileUniqueIdWhenOriginalNameExists();
  await testDownloadUsesCurrentDateWhenMessageDateIsMissing();
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

async function testDownloadUsesOriginalFileName() {
  await withDownloadsDir(async (downloadsDir) => {
    const downloads = [];
    const downloader = createTelegramFileDownloader({
      downloadsDir,
      telegramClient: createMockTelegramClient(downloads)
    });

    const result = await downloader.download({
      file_id: 'file-1',
      file_unique_id: 'unique-1',
      file_name: 'report.pdf',
      message_date: Date.parse('2026-05-15T21:30:00.000Z') / 1000
    });

    assert.strictEqual(result.localPath, path.resolve(downloadsDir, '2026-05-16', 'report.pdf'));
    assert.strictEqual(downloads[0].destinationPath, path.resolve(downloadsDir, '2026-05-16', 'report.pdf'));
  });
}

async function testDownloadAddsFileUniqueIdWhenOriginalNameExists() {
  await withDownloadsDir(async (downloadsDir) => {
    const dateDirectory = path.resolve(downloadsDir, '2026-05-16');
    fs.mkdirSync(dateDirectory, { recursive: true });
    const existingPath = path.resolve(dateDirectory, 'report.pdf');
    fs.writeFileSync(existingPath, 'existing');

    const downloads = [];
    const downloader = createTelegramFileDownloader({
      downloadsDir,
      telegramClient: createMockTelegramClient(downloads)
    });

    const result = await downloader.download({
      file_id: 'file-1',
      file_unique_id: 'unique-1',
      file_name: 'report.pdf',
      message_date: Date.parse('2026-05-15T21:30:00.000Z') / 1000
    });

    assert.strictEqual(result.localPath, path.resolve(downloadsDir, '2026-05-16', 'report-unique-1.pdf'));
    assert.strictEqual(downloads[0].destinationPath, path.resolve(downloadsDir, '2026-05-16', 'report-unique-1.pdf'));
  });
}

async function testDownloadUsesCurrentDateWhenMessageDateIsMissing() {
  await withDownloadsDir(async (downloadsDir) => {
    const downloads = [];
    const downloader = createTelegramFileDownloader({
      downloadsDir,
      telegramClient: createMockTelegramClient(downloads),
      now: () => new Date('2026-05-16T21:30:00.000Z')
    });

    const result = await downloader.download({
      file_id: 'file-1',
      file_unique_id: 'unique-1',
      file_name: 'report.pdf'
    });

    assert.strictEqual(result.localPath, path.resolve(downloadsDir, '2026-05-17', 'report.pdf'));
    assert.strictEqual(downloads[0].destinationPath, path.resolve(downloadsDir, '2026-05-17', 'report.pdf'));
  });
}

async function withDownloadsDir(callback) {
  const downloadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-file-downloader-'));

  try {
    await callback(downloadsDir);
  } finally {
    fs.rmSync(downloadsDir, { recursive: true, force: true });
  }
}

function createMockTelegramClient(downloads) {
  return {
    async getFile() {
      return { file_path: 'documents/report.pdf' };
    },
    async downloadFile(filePath, destinationPath) {
      downloads.push({ filePath, destinationPath });
      return destinationPath;
    }
  };
}

module.exports = {
  runTests
};
