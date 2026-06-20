'use strict';

const SUPPORTED_ATTACHMENT_TYPES = ['document', 'photo', 'video'];

function extractSupportedAttachments(message) {
  if (!message || typeof message !== 'object') {
    return [];
  }

  const attachments = [];

  if (message.document) {
    attachments.push(normalizeAttachment('document', message.document, message));
  }

  if (Array.isArray(message.photo) && message.photo.length > 0) {
    attachments.push(normalizeAttachment('photo', selectLargestPhotoVariant(message.photo), message));
  }

  if (message.video) {
    attachments.push(normalizeAttachment('video', message.video, message));
  }

  return attachments.filter(Boolean);
}

function normalizeAttachment(kind, rawAttachment, message) {
  if (!rawAttachment || !SUPPORTED_ATTACHMENT_TYPES.includes(kind)) {
    return null;
  }

  return {
    file_kind: kind,
    file_id: rawAttachment.file_id || null,
    file_unique_id: rawAttachment.file_unique_id || null,
    file_name: rawAttachment.file_name || defaultFileName(kind),
    mime_type: rawAttachment.mime_type || null,
    file_size: normalizeOptionalNumber(rawAttachment.file_size),
    message_id: message.message_id || null,
    message_date: normalizeOptionalNumber(message.date),
    media_group_id: message.media_group_id || null,
    chat_id: message.chat && message.chat.id ? message.chat.id : null,
    user_id: message.from && message.from.id ? message.from.id : null
  };
}

function selectLargestPhotoVariant(photoVariants) {
  return photoVariants.reduce((largest, current) => {
    const largestSize = normalizeOptionalNumber(largest.file_size) || 0;
    const currentSize = normalizeOptionalNumber(current.file_size) || 0;

    return currentSize >= largestSize ? current : largest;
  });
}

function defaultFileName(kind) {
  return kind === 'photo' ? 'photo.jpg' : null;
}

function normalizeOptionalNumber(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

module.exports = {
  SUPPORTED_ATTACHMENT_TYPES,
  extractSupportedAttachments,
  normalizeAttachment,
  selectLargestPhotoVariant
};
