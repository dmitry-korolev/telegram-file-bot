'use strict';

const fs = require('fs');
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
    const fileName = chooseLocalFileName(downloadsDir, attachment, telegramFilePath);

    return path.resolve(downloadsDir, fileName);
  }
}

function chooseLocalFileName(downloadsDir, attachment, telegramFilePath, currentPath) {
  const originalFileName = attachment.file_name ? sanitizeFileName(path.basename(attachment.file_name)) : null;

  if (!originalFileName) {
    const extension = path.extname(telegramFilePath || '');
    return `${sanitizeFileName(attachment.file_unique_id || attachment.file_id)}${extension}`;
  }

  const originalPath = path.resolve(downloadsDir, originalFileName);

  if (!pathExistsOutsideCurrentPath(originalPath, currentPath)) {
    return originalFileName;
  }

  const parsed = path.parse(originalFileName);
  const baseName = parsed.name || 'telegram-file';
  const uniqueId = sanitizeFileName(attachment.file_unique_id || attachment.file_id);

  return `${baseName}-${uniqueId}${parsed.ext}`;
}

function pathExistsOutsideCurrentPath(targetPath, currentPath) {
  if (!fs.existsSync(targetPath)) {
    return false;
  }

  return !currentPath || path.resolve(targetPath) !== path.resolve(currentPath);
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
  chooseLocalFileName,
  sanitizeFileName
};
