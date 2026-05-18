'use strict';

const { processIncomingMessage } = require('./process-message');
const { DEFAULT_SMALL_FILE_LIMIT_BYTES } = require('../domain/file-size');
const {
  buildClearQueueConfirmedMessage,
  buildClearQueuePrompt,
  buildProcessingResponse,
  buildQueueMessage,
  buildQueueSummaryMessage,
  buildStatsMessage,
  buildShownFilesMessage,
  createClearQueueConfirmationKeyboard,
  createShowNextFilesKeyboard,
  getCommandName,
  isCommandMessage
} = require('../domain/user-messages');

const CALLBACK_SHOW_NEXT_FILES = 'show_next_files';
const CALLBACK_SHOW_LARGEST_FILES = 'show_largest_files';
const CALLBACK_SHOW_SMALLEST_FILES = 'show_smallest_files';
const CALLBACK_CONFIRM_CLEAR_QUEUE = 'confirm_clear_queue';
const CALLBACK_CANCEL_CLEAR_QUEUE = 'cancel_clear_queue';
const MANUAL_DOWNLOAD_BATCH_SIZE = 10;
const DEFAULT_MEDIA_GROUP_RESPONSE_DELAY_MS = 2000;

function createTelegramUpdateHandler(dependencies) {
  const deps = dependencies || {};

  if (!deps.fileRepository) {
    throw new Error('fileRepository is required');
  }

  if (!deps.downloader || typeof deps.downloader.download !== 'function') {
    throw new Error('downloader.download is required');
  }

  if (!deps.messageDeleter || typeof deps.messageDeleter.deleteMessage !== 'function') {
    throw new Error('messageDeleter.deleteMessage is required');
  }

  if (!deps.messageSender || typeof deps.messageSender.sendMessage !== 'function') {
    throw new Error('messageSender.sendMessage is required');
  }

  if (!deps.fileSender || typeof deps.fileSender.sendPhoto !== 'function' || typeof deps.fileSender.sendVideo !== 'function' || typeof deps.fileSender.sendDocument !== 'function') {
    throw new Error('fileSender with sendPhoto/sendVideo/sendDocument is required');
  }

  if (!deps.callbackResponder || typeof deps.callbackResponder.answerCallbackQuery !== 'function') {
    throw new Error('callbackResponder.answerCallbackQuery is required');
  }

  const authorizedUserIds = deps.authorizedUserIds || (deps.authorizedUserId === undefined ? [] : [deps.authorizedUserId]);
  const smallFileLimitBytes = deps.smallFileLimitBytes || DEFAULT_SMALL_FILE_LIMIT_BYTES;
  const now = deps.now || (() => new Date().toISOString());
  const nextQueuePosition = deps.nextQueuePosition || createInMemoryQueuePosition();
  const mediaGroupResponseDelayMs = normalizeNonNegativeInteger(
    deps.mediaGroupResponseDelayMs,
    DEFAULT_MEDIA_GROUP_RESPONSE_DELAY_MS
  );
  const setTimeoutFn = deps.setTimeoutFn || setTimeout;
  const clearTimeoutFn = deps.clearTimeoutFn || clearTimeout;
  const mediaGroupResponses = new Map();

  return {
    handleUpdate
  };

  async function handleUpdate(update) {
    if (update && update.callback_query) {
      return handleCallbackQuery(update.callback_query);
    }

    const message = extractMessage(update);

    if (!message) {
      return {
        accepted: false,
        reason: 'no_message',
        files: [],
        deleteMessageCalled: false,
        sendMessageCalled: false
      };
    }

    const deduplicationKeys = await collectDeduplicationKeys(message);
    const processedMessage = processIncomingMessage(message, {
      authorizedUserIds,
      smallFileLimitBytes,
      knownDeduplicationKeys: deduplicationKeys
    });

    if (!processedMessage.accepted) {
      return {
        accepted: false,
        reason: processedMessage.reason,
        files: [],
        deleteMessageCalled: false,
        sendMessageCalled: false
      };
    }

    if (processedMessage.attachments.length === 0) {
      return handleMessageWithoutSupportedAttachments(message);
    }

    const files = [];

    for (const attachment of processedMessage.attachments) {
      files.push(await processAttachment(attachment));
    }

    let deleteMessageCalled = false;
    let deleteMessageError = null;

    if (processedMessage.attachments.length > 0 && !hasProcessingFailure(files)) {
      deleteMessageCalled = true;

      try {
        await deps.messageDeleter.deleteMessage({
          chatId: message.chat && message.chat.id,
          messageId: message.message_id
        });
      } catch (error) {
        deleteMessageError = error;
      }
    }

    if (deleteMessageError) {
      await persistDeleteMessageFailure(files, deleteMessageError);
    }

    if (message.media_group_id) {
      scheduleMediaGroupResponse(message, files);

      return {
        accepted: true,
        reason: processedMessage.reason,
        files,
        deleteMessageCalled,
        deleteMessageError,
        sendMessageCalled: false,
        sendMessageError: null,
        responseDeferred: true,
        responseText: null
      };
    }

    const responseText = buildProcessingResponse(files);
    let sendMessageCalled = false;
    let sendMessageError = null;

    if (responseText) {
      sendMessageCalled = true;

      try {
        await deps.messageSender.sendMessage({
          chatId: message.chat && message.chat.id,
          text: responseText
        });
      } catch (error) {
        sendMessageError = error;
      }
    }

    return {
      accepted: true,
      reason: processedMessage.reason,
      files,
      deleteMessageCalled,
      deleteMessageError,
      sendMessageCalled,
      sendMessageError,
      responseText
    };
  }

  async function handleMessageWithoutSupportedAttachments(message) {
    if (isCommandMessage(message)) {
      return handleCommandMessage(message);
    }

    let deleteMessageError = null;

    try {
      await deps.messageDeleter.deleteMessage({
        chatId: message.chat && message.chat.id,
        messageId: message.message_id
      });
    } catch (error) {
      deleteMessageError = error;
    }

    return {
      accepted: true,
      reason: 'no_supported_attachments_deleted',
      files: [],
      deleteMessageCalled: true,
      deleteMessageError,
      sendMessageCalled: false
    };
  }

  async function handleCommandMessage(message) {
    const commandName = getCommandName(message);

    if (commandName === '/queue') {
      const text = typeof deps.fileRepository.getManualDownloadQueueSummary === 'function'
        ? buildQueueSummaryMessage(await deps.fileRepository.getManualDownloadQueueSummary())
        : buildQueueMessage(await deps.fileRepository.getManualDownloadQueue({ limit: 100 }));

      await deps.messageSender.sendMessage({
        chatId: message.chat && message.chat.id,
        text,
        replyMarkup: createShowNextFilesKeyboard()
      });

      return {
        accepted: true,
        reason: 'queue_command',
        files: [],
        deleteMessageCalled: false,
        sendMessageCalled: true,
        responseText: text
      };
    }

    if (commandName === '/stats') {
      const stats = await deps.fileRepository.getStats();
      const text = buildStatsMessage(stats);

      await deps.messageSender.sendMessage({
        chatId: message.chat && message.chat.id,
        text
      });

      return {
        accepted: true,
        reason: 'stats_command',
        files: [],
        deleteMessageCalled: false,
        sendMessageCalled: true,
        responseText: text
      };
    }

    if (commandName === '/clear_queue') {
      const text = buildClearQueuePrompt();

      await deps.messageSender.sendMessage({
        chatId: message.chat && message.chat.id,
        text,
        replyMarkup: createClearQueueConfirmationKeyboard()
      });

      return {
        accepted: true,
        reason: 'clear_queue_command',
        files: [],
        deleteMessageCalled: false,
        sendMessageCalled: true,
        responseText: text
      };
    }

    return {
      accepted: true,
      reason: 'unknown_command',
      files: [],
      deleteMessageCalled: false,
      sendMessageCalled: false
    };
  }

  async function handleCallbackQuery(callbackQuery) {
    if (!callbackQuery.from || !authorizedUserIds.includes(callbackQuery.from.id)) {
      return {
        accepted: false,
        reason: 'unauthorized_callback',
        files: [],
        deleteMessageCalled: false,
        sendMessageCalled: false
      };
    }

    await deps.callbackResponder.answerCallbackQuery({
      callbackQueryId: callbackQuery.id
    });

    if (callbackQuery.data === CALLBACK_SHOW_NEXT_FILES) {
      return showManualDownloadBatch(callbackQuery, 'queue');
    }

    if (callbackQuery.data === CALLBACK_SHOW_LARGEST_FILES) {
      return showManualDownloadBatch(callbackQuery, 'size_desc');
    }

    if (callbackQuery.data === CALLBACK_SHOW_SMALLEST_FILES) {
      return showManualDownloadBatch(callbackQuery, 'size_asc');
    }

    if (callbackQuery.data === CALLBACK_CONFIRM_CLEAR_QUEUE) {
      const updated = await deps.fileRepository.markActiveQueueAsDeletedByUser(now());
      await logFileEvents(updated, 'deleted_by_user', 'deleted_by_user');
      const text = buildClearQueueConfirmedMessage(updated.length);

      await deps.messageSender.sendMessage({
        chatId: callbackQuery.message && callbackQuery.message.chat && callbackQuery.message.chat.id,
        text
      });

      return {
        accepted: true,
        reason: 'clear_queue_confirmed',
        files: [],
        deleteMessageCalled: false,
        sendMessageCalled: true,
        responseText: text
      };
    }

    if (callbackQuery.data === CALLBACK_CANCEL_CLEAR_QUEUE) {
      const text = 'Очистка очереди отменена.';

      await deps.messageSender.sendMessage({
        chatId: callbackQuery.message && callbackQuery.message.chat && callbackQuery.message.chat.id,
        text
      });

      return {
        accepted: true,
        reason: 'clear_queue_cancelled',
        files: [],
        deleteMessageCalled: false,
        sendMessageCalled: true,
        responseText: text
      };
    }

    return {
      accepted: true,
      reason: 'unknown_callback',
      files: [],
      deleteMessageCalled: false,
      sendMessageCalled: false
    };
  }

  async function showManualDownloadBatch(callbackQuery, orderBy) {
    const chatId = callbackQuery.message && callbackQuery.message.chat && callbackQuery.message.chat.id;
    const timestamp = now();
    const shownFiles = await deps.fileRepository.getShownToUserFiles();

    if (shownFiles.length > 0) {
      const confirmed = await deps.fileRepository.markFilesAsDownloadConfirmed(shownFiles.map((file) => file.id), timestamp);
      await logFileEvents(confirmed, 'download_confirmed', 'download_confirmed');
    }

    const queue = await deps.fileRepository.getPendingManualDownloadQueue({
      limit: MANUAL_DOWNLOAD_BATCH_SIZE,
      orderBy
    });

    if (queue.length === 0) {
      const text = shownFiles.length > 0 ? 'Больше файлов в очереди нет.' : 'В очереди нет файлов для ручного скачивания.';

      await deps.messageSender.sendMessage({
        chatId,
        text
      });

      return {
        accepted: true,
        reason: 'manual_download_queue_empty',
        files: [],
        confirmedCount: shownFiles.length,
        deleteMessageCalled: false,
        sendMessageCalled: true,
        responseText: text
      };
    }

    const sentFiles = [];
    const failedFiles = [];

    for (const file of queue) {
      try {
        await sendQueuedFile(chatId, file);
        sentFiles.push(file);
      } catch (error) {
        failedFiles.push({ file, error });
        const failed = await deps.fileRepository.markFilesAsSendFailed([file.id], error, now());
        await logFileEvents(failed.length > 0 ? failed : [file], 'send_failed', 'send_failed', error);
      }
    }

    if (sentFiles.length > 0) {
      const confirmed = await deps.fileRepository.markFilesAsDownloadConfirmed(sentFiles.map((file) => file.id), now());
      await logFileEvents(confirmed, 'download_confirmed', 'download_confirmed');
    }

    const remainingCount = await getRemainingManualDownloadCount();
    const text = buildShownFilesMessage(sentFiles.length, remainingCount);

    await deps.messageSender.sendMessage({
      chatId,
      text,
      replyMarkup: remainingCount > 0 ? createShowNextFilesKeyboard() : undefined
    });

    return {
      accepted: true,
      reason: 'manual_download_batch_shown',
      files: sentFiles.map(toResultFile),
      failedFiles: failedFiles.map((failed) => toResultFile(failed.file, 'send_failed')),
      confirmedCount: shownFiles.length,
      deleteMessageCalled: false,
      sendMessageCalled: true,
      responseText: text
    };
  }

  async function sendQueuedFile(chatId, file) {
    if (file.file_kind === 'photo') {
      return deps.fileSender.sendPhoto({ chatId, fileId: file.file_id });
    }

    if (file.file_kind === 'video') {
      return deps.fileSender.sendVideo({ chatId, fileId: file.file_id });
    }

    return deps.fileSender.sendDocument({ chatId, fileId: file.file_id });
  }

  function countPendingFiles(files) {
    return files.filter((file) => file.status === 'pending_manual_download' || file.status === 'pending_size_unknown').length;
  }

  function hasProcessingFailure(files) {
    return files.some((file) => file && typeof file.status === 'string' && file.status.endsWith('_failed'));
  }

  async function getRemainingManualDownloadCount() {
    if (typeof deps.fileRepository.getPendingManualDownloadSummary === 'function') {
      const summary = await deps.fileRepository.getPendingManualDownloadSummary();
      return summary && Number.isFinite(summary.fileCount) ? summary.fileCount : 0;
    }

    if (typeof deps.fileRepository.getManualDownloadQueueSummary === 'function') {
      const summary = await deps.fileRepository.getManualDownloadQueueSummary();
      return summary && Number.isFinite(summary.fileCount) ? summary.fileCount : 0;
    }

    const remainingQueue = await deps.fileRepository.getManualDownloadQueue({
      limit: 100
    });

    return countPendingFiles(remainingQueue);
  }

  function toResultFile(file, overrideStatus) {
    return {
      fileUniqueId: file.file_unique_id,
      fileKind: file.file_kind,
      fileName: file.file_name,
      status: overrideStatus || file.status,
      record: file
    };
  }

  async function collectDeduplicationKeys(message) {
    const initial = processIncomingMessage(message, {
      authorizedUserIds,
      smallFileLimitBytes,
      knownDeduplicationKeys: new Set()
    });

    const keys = new Set();

    if (!initial.accepted) {
      return keys;
    }

    for (const attachment of initial.attachments) {
      if (!attachment.file_unique_id) {
        continue;
      }

      const existingRecord = await deps.fileRepository.findByFileUniqueId(attachment.file_unique_id);

      if (existingRecord) {
        keys.add(attachment.file_unique_id);
      }
    }

    return keys;
  }

  async function processAttachment(attachment) {
    if (attachment.isDuplicate) {
      const result = {
        fileUniqueId: attachment.file_unique_id,
        fileKind: attachment.file_kind,
        fileName: attachment.file_name,
        status: 'duplicate_skipped',
        record: null
      };

      await logFileEvent(result, 'duplicate_skipped');
      await incrementDuplicateCounter();
      return result;
    }

    if (attachment.sizeCategory === 'small') {
      return processSmallAttachment(attachment);
    }

    if (attachment.sizeCategory === 'large') {
      return processLargeAttachment(attachment);
    }

    return processUnknownSizeAttachment(attachment);
  }

  async function processSmallAttachment(attachment) {
    const timestamp = now();
    let downloaded;

    try {
      downloaded = await deps.downloader.download(attachment);
    } catch (error) {
      const record = await deps.fileRepository.create(buildRecord(attachment, {
        status: 'download_failed',
        error_code: 'download_failed',
        error_message: getErrorMessage(error),
        local_path: null,
        queue_position: null,
        received_at: timestamp,
        created_at: timestamp,
        updated_at: timestamp
      }));
      const result = {
        fileUniqueId: attachment.file_unique_id,
        fileKind: attachment.file_kind,
        fileName: attachment.file_name,
        status: 'download_failed',
        errorCode: 'download_failed',
        errorMessage: getErrorMessage(error),
        record
      };

      await logFileEvent(result, 'download_failed', error);
      return result;
    }

    const record = await deps.fileRepository.create(buildRecord(attachment, {
      status: 'downloaded',
      local_path: downloaded && downloaded.localPath ? downloaded.localPath : null,
      queue_position: null,
      downloaded_at: timestamp,
      received_at: timestamp,
      created_at: timestamp,
      updated_at: timestamp
    }));
    const result = {
      fileUniqueId: attachment.file_unique_id,
      fileKind: attachment.file_kind,
      fileName: attachment.file_name,
      status: 'downloaded',
      record
    };

    await logFileEvent(result, 'downloaded');
    return result;
  }

  async function processLargeAttachment(attachment) {
    const timestamp = now();
    const record = await deps.fileRepository.create(buildRecord(attachment, {
      status: 'pending_manual_download',
      queue_position: await nextQueuePosition(attachment),
      received_at: timestamp,
      created_at: timestamp,
      updated_at: timestamp
    }));

    const result = {
      fileUniqueId: attachment.file_unique_id,
      fileKind: attachment.file_kind,
      fileName: attachment.file_name,
      status: 'pending_manual_download',
      record
    };

    await logFileEvent(result, 'pending_manual_download');
    return result;
  }

  async function processUnknownSizeAttachment(attachment) {
    const timestamp = now();
    const record = await deps.fileRepository.create(buildRecord(attachment, {
      status: 'pending_size_unknown',
      queue_position: await nextQueuePosition(attachment),
      received_at: timestamp,
      created_at: timestamp,
      updated_at: timestamp
    }));

    const result = {
      fileUniqueId: attachment.file_unique_id,
      fileKind: attachment.file_kind,
      fileName: attachment.file_name,
      status: 'pending_size_unknown',
      record
    };

    await logFileEvent(result, 'pending_size_unknown');
    return result;
  }

  async function persistDeleteMessageFailure(files, error) {
    const recordIds = files
      .map((file) => file.record && file.record.id)
      .filter((id) => Number.isInteger(id) && id > 0);

    if (recordIds.length > 0 && typeof deps.fileRepository.markFilesDeleteMessageFailed === 'function') {
      const updated = await deps.fileRepository.markFilesDeleteMessageFailed(recordIds, error, now());
      const updatedById = new Map(updated.map((record) => [record.id, record]));

      for (const file of files) {
        if (file.record && updatedById.has(file.record.id)) {
          file.record = updatedById.get(file.record.id);
        }
      }
    }

    await Promise.all(files.map((file) => logFileEvent(file, 'delete_message_failed', error)));
  }

  async function logFileEvents(records, status, eventType, error) {
    await Promise.all((records || []).map((record) => logFileEvent(toResultFile(record, status), eventType, error)));
  }

  async function logFileEvent(file, eventType, error) {
    if (!deps.fileRepository || typeof deps.fileRepository.createFileEvent !== 'function') {
      return null;
    }

    const record = file && file.record ? file.record : null;
    return deps.fileRepository.createFileEvent({
      file_record_id: record && record.id ? record.id : null,
      file_unique_id: file && file.fileUniqueId ? file.fileUniqueId : record && record.file_unique_id,
      file_kind: file && file.fileKind ? file.fileKind : record && record.file_kind,
      status: file && file.status ? file.status : record && record.status,
      event_type: eventType,
      error_code: error ? eventType : file && file.errorCode ? file.errorCode : record && record.error_code,
      error_message: error ? getErrorMessage(error) : file && file.errorMessage ? file.errorMessage : record && record.error_message,
      created_at: now()
    });
  }

  async function incrementDuplicateCounter() {
    if (!deps.fileRepository || typeof deps.fileRepository.incrementMetaCounter !== 'function') {
      return null;
    }

    return deps.fileRepository.incrementMetaCounter('duplicate_skipped_count', 1, now());
  }

  function scheduleMediaGroupResponse(message, files) {
    const mediaGroupId = message.media_group_id;
    const existing = mediaGroupResponses.get(mediaGroupId);
    const buffer = existing || {
      chatId: message.chat && message.chat.id,
      files: [],
      timeoutId: null
    };

    buffer.chatId = message.chat && message.chat.id;
    buffer.files.push(...files);

    if (buffer.timeoutId) {
      clearTimeoutFn(buffer.timeoutId);
    }

    buffer.timeoutId = setTimeoutFn(() => {
      flushMediaGroupResponse(mediaGroupId).catch((error) => {
        console.error(error.stack || error.message || String(error));
      });
    }, mediaGroupResponseDelayMs);

    mediaGroupResponses.set(mediaGroupId, buffer);
  }

  async function flushMediaGroupResponse(mediaGroupId) {
    const buffer = mediaGroupResponses.get(mediaGroupId);

    if (!buffer) {
      return null;
    }

    mediaGroupResponses.delete(mediaGroupId);

    const responseText = buildProcessingResponse(buffer.files);

    if (!responseText) {
      return null;
    }

    await deps.messageSender.sendMessage({
      chatId: buffer.chatId,
      text: responseText
    });

    return responseText;
  }

  function buildRecord(attachment, overrides) {
    return Object.assign({
      authorized_user_id: attachment.user_id,
      chat_id: attachment.chat_id,
      message_id: attachment.message_id,
      media_group_id: attachment.media_group_id || null,
      file_id: attachment.file_id,
      file_unique_id: attachment.file_unique_id,
      file_name: attachment.file_name,
      mime_type: attachment.mime_type,
      file_size: attachment.file_size,
      file_kind: attachment.file_kind,
      deduplication_key: attachment.file_unique_id,
      local_path: null,
      queue_position: null,
      status: 'received',
      error_code: null,
      error_message: null,
      received_at: null,
      downloaded_at: null,
      shown_at: null,
      download_confirmed_at: null,
      created_at: null,
      updated_at: null
    }, overrides);
  }
}

function extractMessage(update) {
  if (!update || typeof update !== 'object') {
    return null;
  }

  return update.message || null;
}

function createInMemoryQueuePosition() {
  let currentPosition = 0;

  return async function nextQueuePosition() {
    currentPosition += 1;
    return currentPosition;
  };
}

function normalizeNonNegativeInteger(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function getErrorMessage(error) {
  return error && error.message ? error.message : String(error || 'unknown_error');
}

module.exports = {
  createTelegramUpdateHandler,
  extractMessage,
  createInMemoryQueuePosition,
  DEFAULT_MEDIA_GROUP_RESPONSE_DELAY_MS,
  CALLBACK_SHOW_NEXT_FILES,
  CALLBACK_SHOW_LARGEST_FILES,
  CALLBACK_SHOW_SMALLEST_FILES,
  CALLBACK_CONFIRM_CLEAR_QUEUE,
  CALLBACK_CANCEL_CLEAR_QUEUE
};
