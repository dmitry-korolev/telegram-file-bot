'use strict';

const { isAuthorizedUser } = require('../domain/authorization');
const { extractSupportedAttachments } = require('../domain/attachments');
const { buildDeduplicationKey, isDuplicateFile } = require('../domain/deduplication');
const { classifyFileSize } = require('../domain/file-size');

function processIncomingMessage(message, options) {
  const normalizedOptions = options || {};
  const authorizedUserIds = normalizedOptions.authorizedUserIds || normalizedOptions.authorizedUserId;
  const smallFileLimitBytes = normalizedOptions.smallFileLimitBytes;
  const knownDeduplicationKeys = normalizedOptions.knownDeduplicationKeys || new Set();

  if (!isAuthorizedUser(message, authorizedUserIds)) {
    return {
      accepted: false,
      reason: 'unauthorized_user',
      attachments: []
    };
  }

  const supportedAttachments = extractSupportedAttachments(message);
  const attachments = supportedAttachments.map((attachment) => {
    const deduplicationKey = buildDeduplicationKey(attachment);
    const duplicate = isDuplicateFile(attachment, knownDeduplicationKeys);
    const sizeCategory = classifyFileSize(attachment.file_size, smallFileLimitBytes);

    return {
      ...attachment,
      deduplicationKey,
      isDuplicate: duplicate,
      sizeCategory
    };
  });

  return {
    accepted: true,
    reason: attachments.length > 0 ? 'supported_attachments_found' : 'no_supported_attachments',
    attachments
  };
}

module.exports = {
  processIncomingMessage
};
