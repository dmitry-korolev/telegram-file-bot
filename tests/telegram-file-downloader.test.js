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
      file_name: 'report.pdf'
    });

    assert.strictEqual(result.localPath, path.resolve(downloadsDir, 'report.pdf'));
    assert.strictEqual(downloads[0].destinationPath, path.resolve(downloadsDir, 'report.pdf'));
  });
}

async function testDownloadAddsFileUniqueIdWhenOriginalNameExists() {
  await withDownloadsDir(async (downloadsDir) => {
    const existingPath = path.resolve(downloadsDir, 'report.pdf');
    fs.writeFileSync(existingPath, 'existing');

    const downloads = [];
    const downloader = createTelegramFileDownloader({
      downloadsDir,
      telegramClient: createMockTelegramClient(downloads)
    });

    const result = await downloader.download({
      file_id: 'file-1',
      file_unique_id: 'unique-1',
      file_name: 'report.pdf'
    });

    assert.strictEqual(result.localPath, path.resolve(downloadsDir, 'report-unique-1.pdf'));
    assert.strictEqual(downloads[0].destinationPath, path.resolve(downloadsDir, 'report-unique-1.pdf'));
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
