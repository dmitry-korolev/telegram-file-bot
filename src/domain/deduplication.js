'use strict';

function buildDeduplicationKey(file) {
  return file && file.file_unique_id ? String(file.file_unique_id) : null;
}

function isDuplicateFile(file, knownDeduplicationKeys) {
  const deduplicationKey = buildDeduplicationKey(file);

  if (!deduplicationKey) {
    return false;
  }

  return knownDeduplicationKeys.has(deduplicationKey);
}

module.exports = {
  buildDeduplicationKey,
  isDuplicateFile
};
