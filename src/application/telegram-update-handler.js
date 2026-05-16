'use strict';

const { processIncomingMessage } = require('./process-message');
const { DEFAULT_SMALL_FILE_LIMIT_BYTES } = require('../domain/file-size');
const {
  buildClearQueueConfirmedMessage,
  buildClearQueuePrompt,
  buildProcessingResponse,
  buildQueueMessage,
  buildShownFilesMessage,
  createClearQueueConfirmationKeyboard,
  createShowNextFilesKeyboard,
  getCommandName,
  isCommandMessage
} = require('../domain/user-messages');

const CALLBACK_SHOW_NEXT_FILES = 'show_next_files';
const CALLBACK_CONFIRM_CLEAR_QUEUE = 'confirm_clear_queue';
const CALLBACK_CANCEL_CLEAR_QUEUE = 'cancel_clear_queue';
const MANUAL_DOWNLOAD_BATCH_SIZE = 10;

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

    if (processedMessage.attachments.length > 0) {
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
      const queue = await deps.fileRepository.getManualDownloadQueue({
        limit: 100
      });
      const text = buildQueueMessage(queue);

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
      return showNextManualDownloadBatch(callbackQuery);
    }

    if (callbackQuery.data === CALLBACK_CONFIRM_CLEAR_QUEUE) {
      const updated = await deps.fileRepository.markActiveQueueAsDeletedByUser(now());
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

  async function showNextManualDownloadBatch(callbackQuery) {
    const chatId = callbackQuery.message && callbackQuery.message.chat && callbackQuery.message.chat.id;
    const timestamp = now();
    const shownFiles = await deps.fileRepository.getShownToUserFiles();

    if (shownFiles.length > 0) {
      await deps.fileRepository.markFilesAsDownloadConfirmed(shownFiles.map((file) => file.id), timestamp);
    }

    const queue = await deps.fileRepository.getPendingManualDownloadQueue({
      limit: MANUAL_DOWNLOAD_BATCH_SIZE
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
        await deps.fileRepository.markFilesAsSendFailed([file.id], error, now());
      }
    }

    if (sentFiles.length > 0) {
      await deps.fileRepository.markFilesAsShownToUser(sentFiles.map((file) => file.id), now());
    }

    const remainingQueue = await deps.fileRepository.getManualDownloadQueue({
      limit: 100
    });
    const remainingCount = countPendingFiles(remainingQueue);
    const text = buildShownFilesMessage(sentFiles.length, remainingCount);

    await deps.messageSender.sendMessage({
      chatId,
      text,
      replyMarkup: createShowNextFilesKeyboard({
        confirmOnly: remainingCount === 0,
        confirmAndShowNext: remainingCount > 0
      })
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
      return {
        fileUniqueId: attachment.file_unique_id,
        fileKind: attachment.file_kind,
        fileName: attachment.file_name,
        status: 'duplicate_skipped',
        record: null
      };
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
    const downloaded = await deps.downloader.download(attachment);
    const timestamp = now();
    const record = await deps.fileRepository.create(buildRecord(attachment, {
      status: 'downloaded',
      local_path: downloaded && downloaded.localPath ? downloaded.localPath : null,
      queue_position: null,
      downloaded_at: timestamp,
      received_at: timestamp,
      created_at: timestamp,
      updated_at: timestamp
    }));

    return {
      fileUniqueId: attachment.file_unique_id,
      fileKind: attachment.file_kind,
      fileName: attachment.file_name,
      status: 'downloaded',
      record
    };
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

    return {
      fileUniqueId: attachment.file_unique_id,
      fileKind: attachment.file_kind,
      fileName: attachment.file_name,
      status: 'pending_manual_download',
      record
    };
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

    return {
      fileUniqueId: attachment.file_unique_id,
      fileKind: attachment.file_kind,
      fileName: attachment.file_name,
      status: 'pending_size_unknown',
      record
    };
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

module.exports = {
  createTelegramUpdateHandler,
  extractMessage,
  createInMemoryQueuePosition,
  CALLBACK_SHOW_NEXT_FILES,
  CALLBACK_CONFIRM_CLEAR_QUEUE,
  CALLBACK_CANCEL_CLEAR_QUEUE
};
