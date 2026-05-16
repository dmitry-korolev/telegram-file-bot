'use strict';

const path = require('path');

function createTelegramFileDownloader(options) {
  const telegramClient = options && options.telegramClient;
  const downloadsDir = options && options.downloadsDir;

  if (!telegramClient || typeof telegramClient.getFile !== 'function' || typeof telegramClient.downloadFile !== 'function') {
    throw new Error('telegramClient with getFile/downloadFile is required');
  }

  if (!downloadsDir) {
    throw new Error('downloadsDir is required');
  }

  return {
    download
  };

  async function download(attachment) {
    const telegramFile = await telegramClient.getFile(attachment.file_id);
    const localPath = buildLocalPath(attachment, telegramFile.file_path);

    await telegramClient.downloadFile(telegramFile.file_path, localPath);

    return {
      localPath,
      telegramFilePath: telegramFile.file_path
    };
  }

  function buildLocalPath(attachment, telegramFilePath) {
    const extension = path.extname(telegramFilePath || attachment.file_name || '');
    const fileName = `${sanitizeFileName(attachment.file_unique_id || attachment.file_id)}${extension}`;

    return path.resolve(downloadsDir, fileName);
  }
}

function sanitizeFileName(value) {
  const sanitized = String(value || 'telegram-file').replace(/[^a-zA-Z0-9._-]/g, '_');

  if (sanitized === '.' || sanitized === '..') {
    return 'telegram-file';
  }

  return sanitized;
}

module.exports = {
  createTelegramFileDownloader,
  sanitizeFileName
};
