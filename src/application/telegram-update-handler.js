'use strict';

const { processIncomingMessage } = require('./process-message');
const { DEFAULT_SMALL_FILE_LIMIT_BYTES, classifyFileSize } = require('../domain/file-size');
const {
  buildArchiveConfirmedMessage,
  buildArchiveFileNotFoundMessage,
  buildArchiveReplyRequiredMessage,
  buildArchiveSummaryMessage,
  buildClearQueueConfirmedMessage,
  buildClearQueuePrompt,
  buildSingleFileResponse,
  buildQueueFileNotFoundMessage,
  buildQueueMessage,
  buildQueueReplyRequiredMessage,
  buildQueueReturnConfirmedMessage,
  buildQueueSummaryMessage,
  buildRetryReplyRequiredMessage,
  buildSearchArchiveSummaryMessage,
  buildSearchContextExpiredMessage,
  buildSearchQueueSummaryMessage,
  buildSearchTermRequiredMessage,
  buildStatsMessage,
  buildShownArchiveFilesMessage,
  buildShownFilesMessage,
  buildShownPotentialDuplicateFilesMessage,
  createClearQueueConfirmationKeyboard,
  createShowNextFilesKeyboard,
  getCommandArgumentText,
  getCommandName,
  isCommandMessage
} = require('../domain/user-messages');

const CALLBACK_SHOW_NEXT_FILES = 'show_next_files';
const CALLBACK_SHOW_LARGEST_FILES = 'show_largest_files';
const CALLBACK_SHOW_SMALLEST_FILES = 'show_smallest_files';
const CALLBACK_SHOW_POSSIBLE_DUPLICATES = 'show_possible_duplicates';
const CALLBACK_SHOW_NEXT_ARCHIVE_FILES = 'show_next_archive_files';
const CALLBACK_SHOW_LARGEST_ARCHIVE_FILES = 'show_largest_archive_files';
const CALLBACK_SHOW_SMALLEST_ARCHIVE_FILES = 'show_smallest_archive_files';
const CALLBACK_CONFIRM_CLEAR_QUEUE = 'confirm_clear_queue';
const CALLBACK_CANCEL_CLEAR_QUEUE = 'cancel_clear_queue';
const CALLBACK_SEARCH_QUEUE_NEXT_PREFIX = 'search_queue_next:';
const CALLBACK_SEARCH_QUEUE_LARGEST_PREFIX = 'search_queue_largest:';
const CALLBACK_SEARCH_QUEUE_SMALLEST_PREFIX = 'search_queue_smallest:';
const CALLBACK_SEARCH_ARCHIVE_NEXT_PREFIX = 'search_archive_next:';
const CALLBACK_SEARCH_ARCHIVE_LARGEST_PREFIX = 'search_archive_largest:';
const CALLBACK_SEARCH_ARCHIVE_SMALLEST_PREFIX = 'search_archive_smallest:';
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
  const logger = normalizeLogger(deps.logger || console);
  const searchContexts = new Map();
  let nextSearchContextId = 1;

  return {
    handleUpdate
  };

  async function handleUpdate(update) {
    logger.log('update handling started', {
      updateId: update && update.update_id,
      updateType: update && update.callback_query ? 'callback_query' : update && update.message ? 'message' : 'unknown'
    });

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

    return processMessage(message, {
      handleCommands: true,
      updateId: update && update.update_id
    });
  }

  async function processMessage(message, options) {
    const normalizedOptions = options || {};
    const deduplicationKeys = await collectDeduplicationKeys(message);
    const processedMessage = processIncomingMessage(message, {
      authorizedUserIds,
      smallFileLimitBytes,
      knownDeduplicationKeys: deduplicationKeys
    });

    if (!processedMessage.accepted) {
      logger.log('message rejected', {
        updateId: normalizedOptions.updateId,
        reason: processedMessage.reason,
        chatId: message.chat && message.chat.id,
        messageId: message.message_id
      });

      return {
        accepted: false,
        reason: processedMessage.reason,
        files: [],
        deleteMessageCalled: false,
        sendMessageCalled: false
      };
    }

    if (processedMessage.attachments.length === 0) {
      if (normalizedOptions.handleCommands === false) {
        return {
          accepted: true,
          reason: 'retry_no_supported_attachments',
          files: [],
          deleteMessageCalled: false,
          sendMessageCalled: false
        };
      }

      return handleMessageWithoutSupportedAttachments(message);
    }

    logger.log('supported attachments found', {
      updateId: normalizedOptions.updateId,
      chatId: message.chat && message.chat.id,
      messageId: message.message_id,
      attachmentCount: processedMessage.attachments.length,
      mediaGroupId: message.media_group_id || null
    });

    const files = [];

    for (const attachment of processedMessage.attachments) {
      files.push(await processAttachment(attachment));
    }

    let deleteMessageCalled = false;
    let deleteMessageError = null;

    if (processedMessage.attachments.length > 0 && !hasProcessingFailure(files)) {
      deleteMessageCalled = true;

      try {
        logger.log('deleting source telegram message', {
          chatId: message.chat && message.chat.id,
          messageId: message.message_id
        });
        await deps.messageDeleter.deleteMessage({
          chatId: message.chat && message.chat.id,
          messageId: message.message_id
        });
      } catch (error) {
        deleteMessageError = error;
        logger.error('source telegram message delete failed', {
          chatId: message.chat && message.chat.id,
          messageId: message.message_id,
          error
        });
      }
    }

    if (deleteMessageError) {
      await persistDeleteMessageFailure(files, deleteMessageError);
    }

    const processingResponse = await sendProcessingResponses(message, files);

    return {
      accepted: true,
      reason: processedMessage.reason,
      files,
      deleteMessageCalled,
      deleteMessageError,
      sendMessageCalled: processingResponse.sendMessageCalled,
      sendMessageError: processingResponse.sendMessageError,
      responseText: processingResponse.responseText,
      responseTexts: processingResponse.responseTexts
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

    if (commandName === '/show_queue') {
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
        reason: 'show_queue_command',
        files: [],
        deleteMessageCalled: false,
        sendMessageCalled: true,
        responseText: text
      };
    }

    if (commandName === '/search_queue') {
      return handleSearchQueueCommand(message);
    }

    if (commandName === '/queue') {
      return handleQueueReturnCommand(message);
    }

    if (commandName === '/retry') {
      return handleRetryCommand(message);
    }

    if (commandName === '/show_archive') {
      const summary = await deps.fileRepository.getArchiveSummary();
      const text = buildArchiveSummaryMessage(summary);

      await deps.messageSender.sendMessage({
        chatId: message.chat && message.chat.id,
        text,
        replyMarkup: summary.fileCount > 0 ? createArchiveKeyboard() : undefined
      });

      return {
        accepted: true,
        reason: 'show_archive_command',
        files: [],
        deleteMessageCalled: false,
        sendMessageCalled: true,
        responseText: text
      };
    }

    if (commandName === '/search_archive') {
      return handleSearchArchiveCommand(message);
    }

    if (commandName === '/archive') {
      return handleArchiveCommand(message);
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

    if (commandName === '/stats_image') {
      if (!deps.statsImageRenderer || typeof deps.statsImageRenderer.renderStatsImage !== 'function') {
        throw new Error('statsImageRenderer.renderStatsImage is required');
      }

      if (typeof deps.fileRepository.getStatsImageData !== 'function') {
        throw new Error('fileRepository.getStatsImageData is required');
      }

      const statsImageData = await deps.fileRepository.getStatsImageData();
      const photoBuffer = await deps.statsImageRenderer.renderStatsImage(statsImageData);

      await deps.fileSender.sendPhoto({
        chatId: message.chat && message.chat.id,
        photoBuffer,
        filename: 'stats.png',
        caption: 'Статистика бота'
      });

      return {
        accepted: true,
        reason: 'stats_image_command',
        files: [],
        deleteMessageCalled: false,
        sendMessageCalled: true,
        responseText: null
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

    if (callbackQuery.data === CALLBACK_SHOW_POSSIBLE_DUPLICATES) {
      return showPotentialDuplicateBatch(callbackQuery);
    }

    if (callbackQuery.data === CALLBACK_SHOW_NEXT_ARCHIVE_FILES) {
      return showArchiveBatch(callbackQuery, 'queue');
    }

    if (callbackQuery.data === CALLBACK_SHOW_LARGEST_ARCHIVE_FILES) {
      return showArchiveBatch(callbackQuery, 'size_desc');
    }

    if (callbackQuery.data === CALLBACK_SHOW_SMALLEST_ARCHIVE_FILES) {
      return showArchiveBatch(callbackQuery, 'size_asc');
    }

    if (callbackQuery.data && callbackQuery.data.startsWith(CALLBACK_SEARCH_QUEUE_NEXT_PREFIX)) {
      return showSearchBatch(callbackQuery, CALLBACK_SEARCH_QUEUE_NEXT_PREFIX, 'queue');
    }

    if (callbackQuery.data && callbackQuery.data.startsWith(CALLBACK_SEARCH_QUEUE_LARGEST_PREFIX)) {
      return showSearchBatch(callbackQuery, CALLBACK_SEARCH_QUEUE_LARGEST_PREFIX, 'size_desc');
    }

    if (callbackQuery.data && callbackQuery.data.startsWith(CALLBACK_SEARCH_QUEUE_SMALLEST_PREFIX)) {
      return showSearchBatch(callbackQuery, CALLBACK_SEARCH_QUEUE_SMALLEST_PREFIX, 'size_asc');
    }

    if (callbackQuery.data && callbackQuery.data.startsWith(CALLBACK_SEARCH_ARCHIVE_NEXT_PREFIX)) {
      return showSearchBatch(callbackQuery, CALLBACK_SEARCH_ARCHIVE_NEXT_PREFIX, 'queue');
    }

    if (callbackQuery.data && callbackQuery.data.startsWith(CALLBACK_SEARCH_ARCHIVE_LARGEST_PREFIX)) {
      return showSearchBatch(callbackQuery, CALLBACK_SEARCH_ARCHIVE_LARGEST_PREFIX, 'size_desc');
    }

    if (callbackQuery.data && callbackQuery.data.startsWith(CALLBACK_SEARCH_ARCHIVE_SMALLEST_PREFIX)) {
      return showSearchBatch(callbackQuery, CALLBACK_SEARCH_ARCHIVE_SMALLEST_PREFIX, 'size_asc');
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

  async function handleRetryCommand(message) {
    const retryMessage = message.reply_to_message;

    if (!retryMessage) {
      return sendRetryReplyRequiredMessage(message, 'retry_reply_required');
    }

    if (retryMessage.media_group_id && typeof deps.fileRepository.findFilesByMediaGroup === 'function') {
      const groupRecords = await deps.fileRepository.findFilesByMediaGroup(
        retryMessage.chat && retryMessage.chat.id,
        retryMessage.media_group_id
      );
      const selectedRecords = selectRetryMediaGroupRecords(groupRecords);

      if (selectedRecords.length > 1) {
        return retryMediaGroupFromRecords(message, retryMessage, selectedRecords);
      }
    }

    const result = await processMessage(retryMessage, {
      handleCommands: false
    });

    if (result.reason === 'retry_no_supported_attachments') {
      return sendRetryReplyRequiredMessage(message, 'retry_no_supported_attachments');
    }

    if (result.accepted) {
      result.reason = `retry_${result.reason}`;
    }

    return result;
  }

  async function retryMediaGroupFromRecords(commandMessage, sourceMessage, records) {
    const files = [];

    for (const record of records) {
      files.push(await processAttachment(await buildRetryAttachmentFromRecord(record)));
    }

    let deleteMessageCalled = false;
    let deleteMessageError = null;

    if (!hasProcessingFailure(files)) {
      deleteMessageCalled = true;

      try {
        await deleteMediaGroupSourceMessages(sourceMessage.chat && sourceMessage.chat.id, records);
      } catch (error) {
        deleteMessageError = error;
        logger.error('retry media group source telegram messages delete failed', {
          chatId: sourceMessage.chat && sourceMessage.chat.id,
          mediaGroupId: sourceMessage.media_group_id,
          error
        });
      }
    }

    if (deleteMessageError) {
      await persistDeleteMessageFailure(files, deleteMessageError);
    }

    const processingResponse = await sendProcessingResponses(commandMessage, files);

    return {
      accepted: true,
      reason: 'retry_media_group_processed',
      files,
      deleteMessageCalled,
      deleteMessageError,
      sendMessageCalled: processingResponse.sendMessageCalled,
      sendMessageError: processingResponse.sendMessageError,
      responseText: processingResponse.responseText,
      responseTexts: processingResponse.responseTexts
    };
  }

  async function buildRetryAttachmentFromRecord(record) {
    const existingRecord = record.file_unique_id && typeof deps.fileRepository.findDeduplicationRecordByFileUniqueId === 'function'
      ? await deps.fileRepository.findDeduplicationRecordByFileUniqueId(record.file_unique_id)
      : null;

    return {
      file_kind: record.file_kind,
      file_id: record.file_id,
      file_unique_id: record.file_unique_id,
      file_name: record.file_name,
      mime_type: record.mime_type,
      file_size: record.file_size,
      message_id: record.message_id,
      message_date: toUnixTimestamp(record.received_at || record.created_at),
      media_group_id: record.media_group_id || null,
      chat_id: record.chat_id,
      user_id: record.authorized_user_id,
      deduplicationKey: record.file_unique_id,
      isDuplicate: Boolean(existingRecord),
      sizeCategory: classifyFileSize(record.file_size, smallFileLimitBytes)
    };
  }

  async function deleteMediaGroupSourceMessages(chatId, records) {
    const messageIds = Array.from(new Set(records
      .map((record) => record.message_id)
      .filter((messageId) => Number.isFinite(messageId))));

    for (const messageId of messageIds) {
      logger.log('deleting retry media group source telegram message', {
        chatId,
        messageId
      });
      await deps.messageDeleter.deleteMessage({
        chatId,
        messageId
      });
    }
  }

  function selectRetryMediaGroupRecords(records) {
    const recordsByUniqueId = new Map();

    for (const record of records || []) {
      if (!record || !record.file_unique_id) {
        continue;
      }

      const existing = recordsByUniqueId.get(record.file_unique_id);

      if (!existing || shouldReplaceRetryMediaGroupRecord(existing, record)) {
        recordsByUniqueId.set(record.file_unique_id, record);
      }
    }

    return Array.from(recordsByUniqueId.values()).sort((left, right) => {
      const leftMessageId = Number.isFinite(left.message_id) ? left.message_id : 0;
      const rightMessageId = Number.isFinite(right.message_id) ? right.message_id : 0;

      if (leftMessageId !== rightMessageId) {
        return leftMessageId - rightMessageId;
      }

      return (left.id || 0) - (right.id || 0);
    });
  }

  function shouldReplaceRetryMediaGroupRecord(current, candidate) {
    if (current.status === 'download_failed' && candidate.status !== 'download_failed') {
      return true;
    }

    if (current.status !== 'download_failed' && candidate.status === 'download_failed') {
      return false;
    }

    return (candidate.id || 0) > (current.id || 0);
  }

  function toUnixTimestamp(value) {
    const time = new Date(value || '').getTime();

    if (!Number.isFinite(time)) {
      return null;
    }

    return Math.floor(time / 1000);
  }

  async function sendRetryReplyRequiredMessage(message, reason) {
    const text = buildRetryReplyRequiredMessage();

    await deps.messageSender.sendMessage({
      chatId: message.chat && message.chat.id,
      text
    });

    return {
      accepted: true,
      reason,
      files: [],
      deleteMessageCalled: false,
      sendMessageCalled: true,
      responseText: text
    };
  }

  async function handleSearchQueueCommand(message) {
    const searchTerm = getCommandArgumentText(message);

    if (!searchTerm) {
      const text = buildSearchTermRequiredMessage('/search_queue');

      await deps.messageSender.sendMessage({
        chatId: message.chat && message.chat.id,
        text
      });

      return {
        accepted: true,
        reason: 'search_queue_term_required',
        files: [],
        deleteMessageCalled: false,
        sendMessageCalled: true,
        responseText: text
      };
    }

    const summary = await deps.fileRepository.searchManualDownloadQueueSummary(searchTerm);
    const text = buildSearchQueueSummaryMessage(searchTerm, summary);
    const contextId = createSearchContext('queue', searchTerm);

    await deps.messageSender.sendMessage({
      chatId: message.chat && message.chat.id,
      text,
      replyMarkup: summary.fileCount > 0 ? createSearchQueueKeyboard(contextId) : undefined
    });

    return {
      accepted: true,
      reason: 'search_queue_command',
      files: [],
      deleteMessageCalled: false,
      sendMessageCalled: true,
      responseText: text
    };
  }

  async function handleSearchArchiveCommand(message) {
    const searchTerm = getCommandArgumentText(message);

    if (!searchTerm) {
      const text = buildSearchTermRequiredMessage('/search_archive');

      await deps.messageSender.sendMessage({
        chatId: message.chat && message.chat.id,
        text
      });

      return {
        accepted: true,
        reason: 'search_archive_term_required',
        files: [],
        deleteMessageCalled: false,
        sendMessageCalled: true,
        responseText: text
      };
    }

    const summary = await deps.fileRepository.searchArchiveSummary(searchTerm);
    const text = buildSearchArchiveSummaryMessage(searchTerm, summary);
    const contextId = createSearchContext('archive', searchTerm);

    await deps.messageSender.sendMessage({
      chatId: message.chat && message.chat.id,
      text,
      replyMarkup: summary.fileCount > 0 ? createSearchArchiveKeyboard(contextId) : undefined
    });

    return {
      accepted: true,
      reason: 'search_archive_command',
      files: [],
      deleteMessageCalled: false,
      sendMessageCalled: true,
      responseText: text
    };
  }

  async function showManualDownloadBatch(callbackQuery, orderBy) {
    return showFileBatch(callbackQuery, {
      source: 'queue',
      orderBy,
      getFiles: (options) => deps.fileRepository.getPendingManualDownloadQueue(options),
      getRemainingCount: getRemainingManualDownloadCount,
      emptyText: 'В очереди нет файлов для ручного скачивания.',
      emptyAfterShownText: 'Больше файлов в очереди нет.',
      buildShownMessage: buildShownFilesMessage,
      createKeyboard: createShowNextFilesKeyboard,
      reasonEmpty: 'manual_download_queue_empty',
      reasonShown: 'manual_download_batch_shown'
    });
  }

  async function showPotentialDuplicateBatch(callbackQuery) {
    return showFileBatch(callbackQuery, {
      source: 'queue',
      orderBy: 'potential_duplicates',
      getFiles: () => deps.fileRepository.getPotentialDuplicateQueueGroup(),
      getRemainingCount: getRemainingPotentialDuplicateGroupCount,
      emptyText: 'В очереди нет возможных дубликатов.',
      emptyAfterShownText: 'В очереди нет возможных дубликатов.',
      buildShownMessage: buildShownPotentialDuplicateFilesMessage,
      createKeyboard: createQueueKeyboard,
      reasonEmpty: 'potential_duplicates_empty',
      reasonShown: 'potential_duplicates_batch_shown'
    });
  }

  async function showSearchBatch(callbackQuery, prefix, orderBy) {
    const contextId = callbackQuery.data.slice(prefix.length);
    const context = searchContexts.get(contextId);

    if (!context) {
      const text = buildSearchContextExpiredMessage();

      await deps.messageSender.sendMessage({
        chatId: callbackQuery.message && callbackQuery.message.chat && callbackQuery.message.chat.id,
        text
      });

      return {
        accepted: true,
        reason: 'search_context_expired',
        files: [],
        deleteMessageCalled: false,
        sendMessageCalled: true,
        responseText: text
      };
    }

    if (context.source === 'archive') {
      return showFileBatch(callbackQuery, {
        source: 'archive',
        orderBy,
        getFiles: (options) => deps.fileRepository.searchArchiveQueue(context.searchTerm, options),
        getRemainingCount: () => getRemainingSearchArchiveCount(context.searchTerm),
        emptyText: 'В архиве нет файлов.',
        emptyAfterShownText: 'Больше файлов в архиве нет.',
        buildShownMessage: buildShownArchiveFilesMessage,
        createKeyboard: () => createSearchArchiveKeyboard(contextId),
        reasonEmpty: 'search_archive_empty',
        reasonShown: 'search_archive_batch_shown'
      });
    }

    return showFileBatch(callbackQuery, {
      source: 'queue',
      orderBy,
      getFiles: (options) => deps.fileRepository.searchPendingManualDownloadQueue(context.searchTerm, options),
      getRemainingCount: () => getRemainingSearchManualDownloadCount(context.searchTerm),
      emptyText: 'В очереди нет файлов для ручного скачивания.',
      emptyAfterShownText: 'Больше файлов в очереди нет.',
      buildShownMessage: buildShownFilesMessage,
      createKeyboard: () => createSearchQueueKeyboard(contextId),
      reasonEmpty: 'search_queue_empty',
      reasonShown: 'search_queue_batch_shown'
    });
  }

  async function showArchiveBatch(callbackQuery, orderBy) {
    return showFileBatch(callbackQuery, {
      source: 'archive',
      orderBy,
      getFiles: (options) => deps.fileRepository.getArchiveQueue(options),
      getRemainingCount: getRemainingArchiveCount,
      emptyText: 'В архиве нет файлов.',
      emptyAfterShownText: 'Больше файлов в архиве нет.',
      buildShownMessage: buildShownArchiveFilesMessage,
      createKeyboard: createArchiveKeyboard,
      reasonEmpty: 'archive_empty',
      reasonShown: 'archive_batch_shown'
    });
  }

  async function showFileBatch(callbackQuery, options) {
    const chatId = callbackQuery.message && callbackQuery.message.chat && callbackQuery.message.chat.id;
    const timestamp = now();
    const shownFiles = options.source === 'queue' ? await deps.fileRepository.getShownToUserFiles() : [];

    if (shownFiles.length > 0) {
      const confirmed = await deps.fileRepository.markFilesAsDownloadConfirmed(shownFiles.map((file) => file.id), timestamp);
      await logFileEvents(confirmed, 'download_confirmed', 'download_confirmed');
    }

    const queue = await options.getFiles({
      limit: MANUAL_DOWNLOAD_BATCH_SIZE,
      orderBy: options.orderBy
    });

    if (queue.length === 0) {
      const text = shownFiles.length > 0 ? options.emptyAfterShownText : options.emptyText;

      await deps.messageSender.sendMessage({
        chatId,
        text
      });

      return {
        accepted: true,
        reason: options.reasonEmpty,
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
        const sentMessage = await sendQueuedFile(chatId, file);
        await recordSentFile(file, sentMessage, chatId, options.source);
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

    const remainingCount = await options.getRemainingCount();
    const text = options.buildShownMessage(sentFiles.length, remainingCount);

    await deps.messageSender.sendMessage({
      chatId,
      text,
      replyMarkup: remainingCount > 0 ? options.createKeyboard() : undefined
    });

    return {
      accepted: true,
      reason: options.reasonShown,
      files: sentFiles.map(toResultFile),
      failedFiles: failedFiles.map((failed) => toResultFile(failed.file, 'send_failed')),
      confirmedCount: shownFiles.length,
      deleteMessageCalled: false,
      sendMessageCalled: true,
      responseText: text
    };
  }

  async function handleArchiveCommand(message) {
    const replyToMessageId = message.reply_to_message && message.reply_to_message.message_id;

    if (!Number.isFinite(replyToMessageId)) {
      const text = buildArchiveReplyRequiredMessage();

      await deps.messageSender.sendMessage({
        chatId: message.chat && message.chat.id,
        text
      });

      return {
        accepted: true,
        reason: 'archive_reply_required',
        files: [],
        deleteMessageCalled: false,
        sendMessageCalled: true,
        responseText: text
      };
    }

    const file = await deps.fileRepository.findFileBySentMessage(
      message.chat && message.chat.id,
      replyToMessageId
    );

    if (!file) {
      const text = buildArchiveFileNotFoundMessage();

      await deps.messageSender.sendMessage({
        chatId: message.chat && message.chat.id,
        text
      });

      return {
        accepted: true,
        reason: 'archive_file_not_found',
        files: [],
        deleteMessageCalled: false,
        sendMessageCalled: true,
        responseText: text
      };
    }

    const archived = await deps.fileRepository.markFilesAsArchived([file.id], now());
    await logFileEvents(archived.length > 0 ? archived : [file], 'archived', 'archived');
    const text = buildArchiveConfirmedMessage();

    await deps.messageSender.sendMessage({
      chatId: message.chat && message.chat.id,
      text
    });

    return {
      accepted: true,
      reason: 'archive_command',
      files: archived.map(toResultFile),
      deleteMessageCalled: false,
      sendMessageCalled: true,
      responseText: text
    };
  }

  async function handleQueueReturnCommand(message) {
    const replyToMessageId = message.reply_to_message && message.reply_to_message.message_id;

    if (!Number.isFinite(replyToMessageId)) {
      const text = buildQueueReplyRequiredMessage();

      await deps.messageSender.sendMessage({
        chatId: message.chat && message.chat.id,
        text
      });

      return {
        accepted: true,
        reason: 'queue_reply_required',
        files: [],
        deleteMessageCalled: false,
        sendMessageCalled: true,
        responseText: text
      };
    }

    const file = await deps.fileRepository.findFileBySentMessage(
      message.chat && message.chat.id,
      replyToMessageId
    );

    if (!file) {
      const text = buildQueueFileNotFoundMessage();

      await deps.messageSender.sendMessage({
        chatId: message.chat && message.chat.id,
        text
      });

      return {
        accepted: true,
        reason: 'queue_file_not_found',
        files: [],
        deleteMessageCalled: false,
        sendMessageCalled: true,
        responseText: text
      };
    }

    const queued = await deps.fileRepository.markFilesAsQueued([file.id], now());
    await logFileEvents(queued.length > 0 ? queued : [file], queued[0] ? queued[0].status : file.status, 'returned_to_queue');
    const text = buildQueueReturnConfirmedMessage();

    await deps.messageSender.sendMessage({
      chatId: message.chat && message.chat.id,
      text
    });

    return {
      accepted: true,
      reason: 'queue_return_command',
      files: queued.map(toResultFile),
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

  async function recordSentFile(file, sentMessage, chatId, source) {
    if (!deps.fileRepository.createSentFile || !sentMessage || !Number.isFinite(sentMessage.message_id)) {
      return null;
    }

    return deps.fileRepository.createSentFile({
      file_record_id: file.id,
      chat_id: chatId,
      sent_message_id: sentMessage.message_id,
      source,
      created_at: now()
    });
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

  async function getRemainingArchiveCount() {
    if (typeof deps.fileRepository.getArchiveSummary === 'function') {
      const summary = await deps.fileRepository.getArchiveSummary();
      return summary && Number.isFinite(summary.fileCount) ? summary.fileCount : 0;
    }

    const archiveQueue = await deps.fileRepository.getArchiveQueue({
      limit: 100
    });

    return archiveQueue.length;
  }

  async function getRemainingSearchManualDownloadCount(searchTerm) {
    const summary = await deps.fileRepository.searchPendingManualDownloadSummary(searchTerm);
    return summary && Number.isFinite(summary.fileCount) ? summary.fileCount : 0;
  }

  async function getRemainingSearchArchiveCount(searchTerm) {
    const summary = await deps.fileRepository.searchArchiveSummary(searchTerm);
    return summary && Number.isFinite(summary.fileCount) ? summary.fileCount : 0;
  }

  async function getRemainingPotentialDuplicateGroupCount() {
    if (typeof deps.fileRepository.getPotentialDuplicateQueueGroupSummary !== 'function') {
      return 0;
    }

    const summary = await deps.fileRepository.getPotentialDuplicateQueueGroupSummary();
    return summary && Number.isFinite(summary.groupCount) ? summary.groupCount : 0;
  }

  function createQueueKeyboard() {
    return createShowNextFilesKeyboard();
  }

  function createArchiveKeyboard() {
    return createShowNextFilesKeyboard({
      callbackData: {
        showNext: CALLBACK_SHOW_NEXT_ARCHIVE_FILES,
        showLargest: CALLBACK_SHOW_LARGEST_ARCHIVE_FILES,
        showSmallest: CALLBACK_SHOW_SMALLEST_ARCHIVE_FILES,
        showPotentialDuplicates: null
      }
    });
  }

  function createSearchQueueKeyboard(contextId) {
    return createShowNextFilesKeyboard({
      callbackData: {
        showNext: `${CALLBACK_SEARCH_QUEUE_NEXT_PREFIX}${contextId}`,
        showLargest: `${CALLBACK_SEARCH_QUEUE_LARGEST_PREFIX}${contextId}`,
        showSmallest: `${CALLBACK_SEARCH_QUEUE_SMALLEST_PREFIX}${contextId}`,
        showPotentialDuplicates: null
      }
    });
  }

  function createSearchArchiveKeyboard(contextId) {
    return createShowNextFilesKeyboard({
      callbackData: {
        showNext: `${CALLBACK_SEARCH_ARCHIVE_NEXT_PREFIX}${contextId}`,
        showLargest: `${CALLBACK_SEARCH_ARCHIVE_LARGEST_PREFIX}${contextId}`,
        showSmallest: `${CALLBACK_SEARCH_ARCHIVE_SMALLEST_PREFIX}${contextId}`,
        showPotentialDuplicates: null
      }
    });
  }

  function createSearchContext(source, searchTerm) {
    const contextId = (nextSearchContextId++).toString(36);
    searchContexts.set(contextId, { source, searchTerm });
    return contextId;
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

      const existingRecord = typeof deps.fileRepository.findDeduplicationRecordByFileUniqueId === 'function'
        ? await deps.fileRepository.findDeduplicationRecordByFileUniqueId(attachment.file_unique_id)
        : await deps.fileRepository.findByFileUniqueId(attachment.file_unique_id);

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
      logDownloadFailure(attachment, error);

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

  function logDownloadFailure(attachment, error) {
    const payload = {
      fileId: attachment && attachment.file_id,
      fileUniqueId: attachment && attachment.file_unique_id,
      fileKind: attachment && attachment.file_kind,
      errorMessage: getErrorMessage(error),
      error
    };

    logger.error('telegram file download failed', payload);
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

  async function sendProcessingResponses(message, files) {
    const responseTexts = (files || [])
      .map((file) => buildSingleFileResponse(file))
      .filter(Boolean);

    for (const responseText of responseTexts) {
      logger.log('queueing processing response', {
        chatId: message.chat && message.chat.id,
        fileCount: 1
      });
      try {
        Promise.resolve(deps.messageSender.sendMessage({
          chatId: message.chat && message.chat.id,
          text: responseText
        })).catch((error) => {
          logger.error('processing response send failed', {
            chatId: message.chat && message.chat.id,
            fileCount: 1,
            error
          });
        });
      } catch (error) {
        logger.error('processing response send failed', {
          chatId: message.chat && message.chat.id,
          fileCount: 1,
          error
        });
      }
    }

    return {
      sendMessageCalled: responseTexts.length > 0,
      sendMessageError: null,
      responseText: responseTexts[0] || null,
      responseTexts
    };
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

function normalizeLogger(logger) {
  return {
    log: typeof logger.log === 'function' ? logger.log.bind(logger) : () => {},
    error: typeof logger.error === 'function' ? logger.error.bind(logger) : () => {},
    warn: typeof logger.warn === 'function' ? logger.warn.bind(logger) : () => {}
  };
}

module.exports = {
  createTelegramUpdateHandler,
  extractMessage,
  createInMemoryQueuePosition,
  CALLBACK_SHOW_NEXT_FILES,
  CALLBACK_SHOW_LARGEST_FILES,
  CALLBACK_SHOW_SMALLEST_FILES,
  CALLBACK_SHOW_POSSIBLE_DUPLICATES,
  CALLBACK_SHOW_NEXT_ARCHIVE_FILES,
  CALLBACK_SHOW_LARGEST_ARCHIVE_FILES,
  CALLBACK_SHOW_SMALLEST_ARCHIVE_FILES,
  CALLBACK_CONFIRM_CLEAR_QUEUE,
  CALLBACK_CANCEL_CLEAR_QUEUE,
  normalizeLogger
};
