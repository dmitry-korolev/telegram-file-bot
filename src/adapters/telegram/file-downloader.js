'use strict';

const fs = require('fs');
const path = require('path');

function createTelegramFileDownloader(options) {
  const telegramClient = options && options.telegramClient;
  const downloadsDir = options && options.downloadsDir;
  const logger = options && options.logger ? options.logger : createSilentLogger();
  const now = options && typeof options.now === 'function' ? options.now : () => new Date();

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
    logger.log('attachment download started', {
      fileId: attachment.file_id,
      fileUniqueId: attachment.file_unique_id,
      fileKind: attachment.file_kind,
      fileName: attachment.file_name,
      downloadsDir
    });
    const telegramFile = await telegramClient.getFile(attachment.file_id);
    const localPath = buildLocalPath(attachment, telegramFile.file_path);

    logger.log('telegram file path resolved', {
      fileId: attachment.file_id,
      fileUniqueId: attachment.file_unique_id,
      telegramFilePath: telegramFile.file_path,
      localPath
    });
    await telegramClient.downloadFile(telegramFile.file_path, localPath);

    logger.log('attachment download finished', {
      fileId: attachment.file_id,
      fileUniqueId: attachment.file_unique_id,
      fileKind: attachment.file_kind,
      localPath
    });
    return {
      localPath,
      telegramFilePath: telegramFile.file_path
    };
  }

  function buildLocalPath(attachment, telegramFilePath) {
    const authorDirectoryName = sanitizeDirectoryName(attachment.author);
    const directoryName = authorDirectoryName || formatDateDirectoryName(attachment.message_date, now);
    const targetDirectory = path.resolve(downloadsDir, directoryName);
    const fileName = chooseLocalFileName(targetDirectory, attachment, telegramFilePath);

    return path.resolve(targetDirectory, fileName);
  }
}

function formatDateDirectoryName(messageDate, now, timeZone) {
  const date = normalizeMessageDate(messageDate) || normalizeNow(now);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(date).reduce((indexedParts, part) => {
    indexedParts[part.type] = part.value;
    return indexedParts;
  }, {});

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function normalizeMessageDate(messageDate) {
  const parsed = Number(messageDate);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  const date = new Date(parsed * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeNow(now) {
  const value = typeof now === 'function' ? now() : new Date();
  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? new Date() : date;
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

function sanitizeDirectoryName(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const sanitized = value
    .normalize('NFC')
    .replace(/[\/\\\u0000-\u001F\u007F]/gu, '_')
    .trim();

  if (!sanitized || sanitized === '.' || sanitized === '..') {
    return null;
  }

  return sanitized;
}

function createSilentLogger() {
  return {
    log() {}
  };
}

module.exports = {
  createTelegramFileDownloader,
  chooseLocalFileName,
  formatDateDirectoryName,
  sanitizeDirectoryName,
  sanitizeFileName
};
