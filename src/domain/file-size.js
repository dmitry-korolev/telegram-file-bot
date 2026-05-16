'use strict';

const DEFAULT_SMALL_FILE_LIMIT_BYTES = 20 * 1024 * 1024;

function classifyFileSize(fileSize, limitBytes) {
  const normalizedLimit = Number.isFinite(limitBytes) ? limitBytes : DEFAULT_SMALL_FILE_LIMIT_BYTES;

  if (!Number.isFinite(fileSize)) {
    return 'unknown';
  }

  return fileSize <= normalizedLimit ? 'small' : 'large';
}

module.exports = {
  DEFAULT_SMALL_FILE_LIMIT_BYTES,
  classifyFileSize
};
