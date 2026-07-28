'use strict';

const assert = require('assert');

const {
  CALLBACK_CANCEL_CLEAR_QUEUE,
  CALLBACK_CONFIRM_CLEAR_QUEUE,
  CALLBACK_RETURN_FILE_TO_ARCHIVE,
  CALLBACK_RETURN_FILE_TO_QUEUE,
  CALLBACK_SHOW_LARGEST_ARCHIVE_FILES,
  CALLBACK_SHOW_LARGEST_FILES,
  CALLBACK_SHOW_NEXT_ARCHIVE_FILES,
  CALLBACK_SHOW_NEXT_FILES,
  CALLBACK_SHOW_POSSIBLE_DUPLICATES,
  CALLBACK_SHOW_SMALLEST_ARCHIVE_FILES,
  CALLBACK_SHOW_SMALLEST_FILES,
  createTelegramUpdateHandler
} = require('../src/application/telegram-update-handler');
const { DEFAULT_SMALL_FILE_LIMIT_BYTES } = require('../src/domain/file-size');

async function runTests() {
  await testExtractsSupportedAttachmentsAndIgnoresUnsupported();
  await testIgnoresUnauthorizedMessages();
  await testSecondAuthorizedUserIsAccepted();
  await testSmallFilesUseDownloaderAndDownloadedRecord();
  await testSmallDownloadFailureCreatesFailedRecordAndResponds();
  await testSmallDownloadRetriesTransientFailure();
  await testSmallDownloadRetriesUntilFinalFailure();
  await testDownloadFailedRecordDoesNotBlockRetry();
  await testSuccessfulRetryBlocksLaterDuplicates();
  await testLargeFilesAreQueuedWithoutDownloader();
  await testAuthorIsPersistedForAllSizeCategories();
  await testDuplicateFilesAreSkipped();
  await testUnknownSizeFilesUseManualQueueStatus();
  await testTextMessageWithoutAttachmentsIsDeleted();
  await testCommandMessageWithoutAttachmentsIsNotDeleted();
  await testRetryCommandRequiresReply();
  await testRetryCommandRequiresSupportedReply();
  await testRetryCommandProcessesRepliedDocument();
  await testRetryCommandReportsDuplicateRepliedDocument();
  await testRetryCommandRetriesFailedRepliedDocument();
  await testRetryCommandProcessesKnownMediaGroupRecords();
  await testRetryCommandRejectsUnauthorizedRepliedMessage();
  await testProcessingSendsSingleFileResponse();
  await testProcessingSendsSeparateFileResponses();
  await testProcessingResponseDoesNotWaitForQueuedSend();
  await testProcessingResponseLogsAsyncSendFailure();
  await testDeleteMessageFailureIsRecordedWithoutStatusOverwrite();
  await testDeleteMessageRetriesTransientFailure();
  await testDeleteMessageNotFoundIsTreatedAsDeleted();
  await testMediaGroupSendsImmediateFileResponses();
  await testMediaGroupInheritsAuthorFromFirstCaption();
  await testMediaGroupCachesAuthorWhenCaptionFileIsDuplicate();
  await testMediaGroupRestoresAuthorFromRepository();
  await testSeparateMediaGroupsSendImmediateResponses();
  await testShowQueueCommandShowsQueue();
  await testSearchQueueCommandShowsFilteredQueueAndButtons();
  await testSearchQueueButtonShowsFilteredBatch();
  await testFileActionButtonsMoveSentFile();
  await testQueueCommandRequiresReply();
  await testQueueCommandReportsUnknownReply();
  await testQueueCommandReturnsReplyFileToQueue();
  await testArchiveCommandRequiresReply();
  await testArchiveCommandReportsUnknownReply();
  await testArchiveCommandMarksReplyFileArchived();
  await testShowArchiveCommandShowsArchiveSummary();
  await testSearchArchiveCommandShowsFilteredArchiveAndButtons();
  await testSearchDownloadedShowsDistinctBatchesWithoutChangingStatuses();
  await testStatsCommandShowsAggregateStats();
  await testStatsImageCommandSendsPngPhoto();
  await testClearQueueCommandRequestsConfirmation();
  await testConfirmClearQueueMarksRecordsDeleted();
  await testUnauthorizedCallbackIsIgnored();
  await testExpiredCallbackAnswerDoesNotBlockAction();
  await testUnexpectedCallbackAnswerFailureStopsAction();
  await testShowNextFilesSendsAtMostTenAndMarksShown();
  await testManualDownloadUsesAuthorAsOnlyCaption();
  await testShowLargestFilesUsesSizeDescendingOrder();
  await testShowSmallestFilesUsesSizeAscendingOrder();
  await testShowPossibleDuplicatesSendsLargestAggregateGroup();
  await testShowPossibleDuplicatesReportsEmptyQueue();
  await testShowNextFilesConfirmsPreviouslyShownFirst();
  await testShowNextFilesUsesQueueSummaryForRemainingCount();
  await testShowNextFilesReportsEmptyQueue();
  await testShowArchiveFilesSendsAndConfirmsArchivedFiles();
  await testSendFailureMarksOnlyFailedFile();
}

async function testStatsCommandShowsAggregateStats() {
  const deps = createMockDependencies({
    stats: {
      totalFiles: 4,
      totalKnownSize: 38 * 1024 * 1024,
      activeQueueFiles: 1,
      activeQueueKnownSize: 25 * 1024 * 1024,
      downloadedFiles: 1,
      downloadConfirmedFiles: 1,
      duplicateFiles: 0,
      failedFiles: 1,
      documentFiles: 2,
      photoFiles: 1,
      videoFiles: 1,
      unknownSizeFiles: 1
    }
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 19,
    message: createMessage({ text: '/stats' })
  });

  assert.strictEqual(result.reason, 'stats_command');
  assert.strictEqual(deps.messageSender.calls.length, 1);
  assert.strictEqual(deps.messageSender.calls[0].text.includes('Статистика бота:'), true);
  assert.strictEqual(deps.messageSender.calls[0].text.includes('Всего файлов: 4'), true);
}

async function testStatsImageCommandSendsPngPhoto() {
  const statsImageData = {
    stats: {
      totalFiles: 4,
      totalKnownSize: 38 * 1024 * 1024
    },
    sizeBuckets: {
      '20_50_mb': 4
    }
  };
  const deps = createMockDependencies({
    statsImageData,
    statsImageBuffer: Buffer.from('png-data')
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 20,
    message: createMessage({ text: '/stats_image' })
  });

  assert.strictEqual(result.reason, 'stats_image_command');
  assert.strictEqual(deps.statsImageRenderer.calls.length, 1);
  assert.strictEqual(deps.statsImageRenderer.calls[0], statsImageData);
  assert.strictEqual(deps.fileSender.calls.length, 1);
  assert.strictEqual(deps.fileSender.calls[0].method, 'sendPhoto');
  assert.strictEqual(deps.fileSender.calls[0].filename, 'stats.png');
  assert.strictEqual(deps.fileSender.calls[0].caption, 'Статистика бота');
  assert.deepStrictEqual(deps.fileSender.calls[0].photoBuffer, Buffer.from('png-data'));
}

async function testExtractsSupportedAttachmentsAndIgnoresUnsupported() {
  const deps = createMockDependencies();
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 1,
    message: createMessage({
      document: createTelegramFile('doc-small', 'uniq-doc-small', 1024, {
        file_name: 'small.txt',
        mime_type: 'text/plain'
      }),
      photo: [
        createTelegramFile('photo-small-low', 'uniq-photo-low', 1000),
        createTelegramFile('photo-small-high', 'uniq-photo-high', 3000)
      ],
      video: createTelegramFile('video-large', 'uniq-video-large', DEFAULT_SMALL_FILE_LIMIT_BYTES + 1),
      audio: createTelegramFile('audio-ignored', 'uniq-audio', 1024),
      voice: createTelegramFile('voice-ignored', 'uniq-voice', 1024),
      sticker: createTelegramFile('sticker-ignored', 'uniq-sticker', 1024),
      animation: createTelegramFile('animation-ignored', 'uniq-animation', 1024)
    })
  });

  assert.strictEqual(result.accepted, true);
  assert.deepStrictEqual(
    result.files.map((file) => file.fileKind),
    ['document', 'photo', 'video']
  );
  assert.deepStrictEqual(
    deps.downloader.calls.map((attachment) => attachment.file_id),
    ['doc-small', 'photo-small-high']
  );
  assert.deepStrictEqual(
    deps.fileRepository.records.map((record) => record.file_unique_id),
    ['uniq-doc-small', 'uniq-photo-high', 'uniq-video-large']
  );
  assert.strictEqual(deps.messageDeleter.calls.length, 1);
  assert.deepStrictEqual(
    deps.messageSender.calls.map((call) => call.text),
    [
      'Файл "small.txt" скачан: /tmp/doc-small',
      'Файл "photo.jpg" скачан: /tmp/photo-small-high',
      'Файл "video" добавлен в очередь.'
    ]
  );
}

async function testIgnoresUnauthorizedMessages() {
  const deps = createMockDependencies();
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 2,
    message: createMessage({
      from: { id: 999 },
      document: createTelegramFile('doc-small', 'uniq-doc-small', 1024)
    })
  });

  assert.strictEqual(result.accepted, false);
  assert.strictEqual(result.reason, 'unauthorized_user');
  assert.deepStrictEqual(deps.downloader.calls, []);
  assert.deepStrictEqual(deps.fileRepository.records, []);
  assert.deepStrictEqual(deps.messageDeleter.calls, []);
  assert.deepStrictEqual(deps.messageSender.calls, []);
}

async function testSecondAuthorizedUserIsAccepted() {
  const deps = createMockDependencies();
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 20,
    message: createMessage({
      from: { id: 77 },
      document: createTelegramFile('doc-small', 'uniq-doc-small-77', 1024)
    })
  });

  assert.strictEqual(result.accepted, true);
  assert.strictEqual(deps.fileRepository.records[0].authorized_user_id, 77);
}

async function testSmallFilesUseDownloaderAndDownloadedRecord() {
  const deps = createMockDependencies();
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 3,
    message: createMessage({
      document: createTelegramFile('doc-small', 'uniq-doc-small', DEFAULT_SMALL_FILE_LIMIT_BYTES)
    })
  });

  assert.strictEqual(deps.downloader.calls.length, 1);
  assert.strictEqual(deps.downloader.calls[0].file_unique_id, 'uniq-doc-small');
  assert.strictEqual(result.files[0].status, 'downloaded');
  assert.strictEqual(deps.fileRepository.records[0].status, 'downloaded');
  assert.strictEqual(deps.fileRepository.records[0].local_path, '/tmp/doc-small');
  assert.strictEqual(deps.fileRepository.records[0].queue_position, null);
  assert.strictEqual(deps.messageDeleter.calls.length, 1);
  assert.strictEqual(deps.messageSender.calls.length, 1);
  assert.strictEqual(
    deps.messageSender.calls[0].text,
    'Файл "file" скачан: /tmp/doc-small'
  );
  assert.deepStrictEqual(result.responseTexts, ['Файл "file" скачан: /tmp/doc-small']);
}

async function testSmallDownloadFailureCreatesFailedRecordAndResponds() {
  const deps = createMockDependencies({
    failingDownloadFileIds: ['doc-small']
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 21,
    message: createMessage({
      document: createTelegramFile('doc-small', 'uniq-doc-small-failed', DEFAULT_SMALL_FILE_LIMIT_BYTES)
    })
  });

  assert.strictEqual(result.accepted, true);
  assert.strictEqual(result.files[0].status, 'download_failed');
  assert.strictEqual(deps.downloader.calls.length, 20);
  assert.strictEqual(deps.downloadRetryDelays.length, 19);
  assert.strictEqual(deps.downloadRetryDelays.every((delayMs) => delayMs === 1000), true);
  assert.strictEqual(deps.fileRepository.records[0].status, 'download_failed');
  assert.strictEqual(deps.fileRepository.records[0].error_code, 'download_failed');
  assert.strictEqual(deps.fileRepository.records[0].error_message, 'Cannot download doc-small');
  assert.strictEqual(deps.fileRepository.records[0].local_path, null);
  assert.strictEqual(result.deleteMessageCalled, false);
  assert.strictEqual(deps.messageDeleter.calls.length, 0);
  assert.strictEqual(deps.messageSender.calls[0].text, 'Файл "file" не удалось скачать.');
  assert.strictEqual(deps.fileRepository.events.some((event) => event.event_type === 'download_failed'), true);
}

async function testSmallDownloadRetriesTransientFailure() {
  const deps = createMockDependencies({
    downloadFailuresByFileId: {
      'doc-small': 1
    },
    downloadRetryDelayMs: 1
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 65,
    message: createMessage({
      document: createTelegramFile('doc-small', 'uniq-doc-small-transient', DEFAULT_SMALL_FILE_LIMIT_BYTES)
    })
  });

  assert.strictEqual(result.files[0].status, 'downloaded');
  assert.strictEqual(deps.downloader.calls.length, 2);
  assert.deepStrictEqual(deps.downloadRetryDelays, [1]);
  assert.strictEqual(deps.fileRepository.records.length, 1);
  assert.strictEqual(deps.fileRepository.records[0].status, 'downloaded');
  assert.strictEqual(deps.fileRepository.events.length, 1);
  assert.strictEqual(deps.fileRepository.events[0].event_type, 'downloaded');
  assert.strictEqual(deps.messageDeleter.calls.length, 1);
}

async function testSmallDownloadRetriesUntilFinalFailure() {
  const deps = createMockDependencies({
    failingDownloadFileIds: ['doc-small'],
    downloadMaxAttempts: 3,
    downloadRetryDelayMs: 1
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 67,
    message: createMessage({
      document: createTelegramFile('doc-small', 'uniq-doc-small-final-failure', DEFAULT_SMALL_FILE_LIMIT_BYTES)
    })
  });

  assert.strictEqual(result.files[0].status, 'download_failed');
  assert.strictEqual(deps.downloader.calls.length, 3);
  assert.deepStrictEqual(deps.downloadRetryDelays, [1, 1]);
  assert.strictEqual(deps.fileRepository.records.length, 1);
  assert.strictEqual(deps.fileRepository.records[0].status, 'download_failed');
  assert.strictEqual(deps.fileRepository.events.length, 1);
  assert.strictEqual(deps.fileRepository.events[0].event_type, 'download_failed');
  assert.strictEqual(result.deleteMessageCalled, false);
  assert.strictEqual(deps.messageDeleter.calls.length, 0);
}

async function testDownloadFailedRecordDoesNotBlockRetry() {
  const deps = createMockDependencies({
    records: [
      createRepositoryRecord({
        file_id: 'doc-small',
        file_unique_id: 'uniq-retry-after-failure',
        status: 'download_failed',
        error_code: 'download_failed'
      })
    ]
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 58,
    message: createMessage({
      document: createTelegramFile('doc-small', 'uniq-retry-after-failure', 1024)
    })
  });

  assert.strictEqual(result.files[0].status, 'downloaded');
  assert.strictEqual(deps.downloader.calls.length, 1);
  assert.strictEqual(deps.fileRepository.records.length, 2);
  assert.strictEqual(deps.fileRepository.records[1].status, 'downloaded');
}

async function testSuccessfulRetryBlocksLaterDuplicates() {
  const deps = createMockDependencies({
    records: [
      createRepositoryRecord({
        file_id: 'doc-failed',
        file_unique_id: 'uniq-retry-then-duplicate',
        status: 'download_failed',
        error_code: 'download_failed'
      }),
      createRepositoryRecord({
        file_id: 'doc-downloaded',
        file_unique_id: 'uniq-retry-then-duplicate',
        status: 'downloaded',
        local_path: '/tmp/doc-downloaded'
      })
    ]
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 59,
    message: createMessage({
      document: createTelegramFile('doc-new', 'uniq-retry-then-duplicate', 1024)
    })
  });

  assert.strictEqual(result.files[0].status, 'duplicate_skipped');
  assert.strictEqual(deps.downloader.calls.length, 0);
}

async function testLargeFilesAreQueuedWithoutDownloader() {
  const deps = createMockDependencies();
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 4,
    message: createMessage({
      video: createTelegramFile('video-large', 'uniq-video-large', DEFAULT_SMALL_FILE_LIMIT_BYTES + 1)
    })
  });

  assert.deepStrictEqual(deps.downloader.calls, []);
  assert.strictEqual(result.files[0].status, 'pending_manual_download');
  assert.strictEqual(deps.fileRepository.records[0].status, 'pending_manual_download');
  assert.strictEqual(deps.fileRepository.records[0].queue_position, 1);
  assert.strictEqual(deps.messageDeleter.calls.length, 1);
  assert.strictEqual(deps.messageSender.calls.length, 1);
  assert.strictEqual(
    deps.messageSender.calls[0].text,
    'Файл "video" добавлен в очередь.'
  );
}

async function testAuthorIsPersistedForAllSizeCategories() {
  const deps = createMockDependencies();
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 68,
    message: createMessage({
      caption: '👤 Straight Archive (Member)\n🎩 @APCL_Official_Channel 🆕 🔥',
      document: createTelegramFile('doc-small', 'uniq-author-small', 1024),
      photo: [
        createTelegramFile('photo-large', 'uniq-author-large', DEFAULT_SMALL_FILE_LIMIT_BYTES + 1)
      ],
      video: createTelegramFile('video-unknown', 'uniq-author-unknown', undefined)
    })
  });

  assert.deepStrictEqual(
    result.files.map((file) => file.status),
    ['downloaded', 'pending_manual_download', 'pending_size_unknown']
  );
  assert.deepStrictEqual(
    deps.fileRepository.records.map((record) => record.author),
    ['Straight Archive', 'Straight Archive', 'Straight Archive']
  );
  assert.strictEqual(deps.downloader.calls[0].author, 'Straight Archive');
}

async function testDuplicateFilesAreSkipped() {
  const deps = createMockDependencies({
    existingFileUniqueIds: ['uniq-duplicate']
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 5,
    message: createMessage({
      document: createTelegramFile('doc-duplicate', 'uniq-duplicate', 1024)
    })
  });

  assert.strictEqual(result.files[0].status, 'duplicate_skipped');
  assert.deepStrictEqual(deps.downloader.calls, []);
  assert.deepStrictEqual(deps.fileRepository.records, []);
  assert.strictEqual(deps.fileRepository.metaCounters.duplicate_skipped_count, 1);
  assert.strictEqual(deps.messageDeleter.calls.length, 1);
  assert.strictEqual(deps.messageSender.calls.length, 1);
  assert.strictEqual(
    deps.messageSender.calls[0].text,
    'Файл "file" уже был раньше.'
  );
}

async function testUnknownSizeFilesUseManualQueueStatus() {
  const deps = createMockDependencies();
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 6,
    message: createMessage({
      document: createTelegramFile('doc-unknown', 'uniq-doc-unknown', undefined)
    })
  });

  assert.deepStrictEqual(deps.downloader.calls, []);
  assert.strictEqual(result.files[0].status, 'pending_size_unknown');
  assert.strictEqual(deps.fileRepository.records[0].status, 'pending_size_unknown');
  assert.strictEqual(deps.fileRepository.records[0].queue_position, 1);
  assert.strictEqual(deps.messageDeleter.calls.length, 1);
  assert.strictEqual(deps.messageSender.calls.length, 1);
}

async function testTextMessageWithoutAttachmentsIsDeleted() {
  const deps = createMockDependencies();
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 7,
    message: createMessage({
      text: 'hello'
    })
  });

  assert.strictEqual(result.reason, 'no_supported_attachments_deleted');
  assert.strictEqual(result.deleteMessageCalled, true);
  assert.strictEqual(deps.messageDeleter.calls.length, 1);
  assert.deepStrictEqual(deps.messageSender.calls, []);
}

async function testCommandMessageWithoutAttachmentsIsNotDeleted() {
  const deps = createMockDependencies();
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 8,
    message: createMessage({
      text: '/show_queue'
    })
  });

  assert.strictEqual(result.reason, 'show_queue_command');
  assert.strictEqual(result.deleteMessageCalled, false);
  assert.deepStrictEqual(deps.messageDeleter.calls, []);
  assert.strictEqual(deps.messageSender.calls.length, 1);
}

async function testRetryCommandRequiresReply() {
  const deps = createMockDependencies();
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 60,
    message: createMessage({
      text: '/retry'
    })
  });

  assert.strictEqual(result.reason, 'retry_reply_required');
  assert.strictEqual(result.deleteMessageCalled, false);
  assert.deepStrictEqual(deps.messageDeleter.calls, []);
  assert.strictEqual(deps.messageSender.calls.length, 1);
  assert.strictEqual(deps.messageSender.calls[0].text, 'Отправьте /retry в ответ на сообщение с файлом.');
}

async function testRetryCommandRequiresSupportedReply() {
  const deps = createMockDependencies();
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 61,
    message: createMessage({
      text: '/retry',
      reply_to_message: createMessage({
        message_id: 1002,
        text: 'hello'
      })
    })
  });

  assert.strictEqual(result.reason, 'retry_no_supported_attachments');
  assert.strictEqual(result.deleteMessageCalled, false);
  assert.deepStrictEqual(deps.downloader.calls, []);
  assert.deepStrictEqual(deps.messageDeleter.calls, []);
  assert.strictEqual(deps.messageSender.calls.length, 1);
  assert.strictEqual(deps.messageSender.calls[0].text, 'Отправьте /retry в ответ на сообщение с файлом.');
}

async function testRetryCommandProcessesRepliedDocument() {
  const deps = createMockDependencies();
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 62,
    message: createMessage({
      message_id: 2002,
      text: '/retry',
      reply_to_message: createMessage({
        message_id: 1002,
        document: createTelegramFile('doc-retry', 'uniq-doc-retry', 1024, {
          file_name: 'retry.txt'
        })
      })
    })
  });

  assert.strictEqual(result.reason, 'retry_supported_attachments_found');
  assert.strictEqual(result.files[0].status, 'downloaded');
  assert.strictEqual(deps.downloader.calls.length, 1);
  assert.strictEqual(deps.downloader.calls[0].file_unique_id, 'uniq-doc-retry');
  assert.strictEqual(deps.fileRepository.records[0].message_id, 1002);
  assert.strictEqual(deps.messageDeleter.calls.length, 1);
  assert.deepStrictEqual(deps.messageDeleter.calls[0], {
    chatId: 5001,
    messageId: 1002
  });
  assert.strictEqual(deps.messageSender.calls.length, 1);
  assert.strictEqual(deps.messageSender.calls[0].text, 'Файл "retry.txt" скачан: /tmp/doc-retry');
}

async function testRetryCommandReportsDuplicateRepliedDocument() {
  const deps = createMockDependencies({
    existingFileUniqueIds: ['uniq-retry-duplicate']
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 63,
    message: createMessage({
      text: '/retry',
      reply_to_message: createMessage({
        message_id: 1003,
        document: createTelegramFile('doc-duplicate', 'uniq-retry-duplicate', 1024)
      })
    })
  });

  assert.strictEqual(result.reason, 'retry_supported_attachments_found');
  assert.strictEqual(result.files[0].status, 'duplicate_skipped');
  assert.deepStrictEqual(deps.downloader.calls, []);
  assert.deepStrictEqual(deps.fileRepository.records, []);
  assert.strictEqual(deps.messageDeleter.calls.length, 1);
  assert.strictEqual(deps.messageSender.calls[0].text, 'Файл "file" уже был раньше.');
}

async function testRetryCommandRetriesFailedRepliedDocument() {
  const deps = createMockDependencies({
    records: [
      createRepositoryRecord({
        file_id: 'doc-failed',
        file_unique_id: 'uniq-retry-failed-reply',
        status: 'download_failed',
        error_code: 'download_failed'
      })
    ]
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 64,
    message: createMessage({
      text: '/retry',
      reply_to_message: createMessage({
        message_id: 1004,
        document: createTelegramFile('doc-retry-after-failed', 'uniq-retry-failed-reply', 1024)
      })
    })
  });

  assert.strictEqual(result.reason, 'retry_supported_attachments_found');
  assert.strictEqual(result.files[0].status, 'downloaded');
  assert.strictEqual(deps.downloader.calls.length, 1);
  assert.strictEqual(deps.fileRepository.records.length, 2);
  assert.strictEqual(deps.fileRepository.records[1].status, 'downloaded');
}

async function testRetryCommandProcessesKnownMediaGroupRecords() {
  const deps = createMockDependencies({
    records: [
      createRepositoryRecord({
        id: 10,
        message_id: 2001,
        media_group_id: 'album-retry',
        file_id: 'photo-downloaded',
        file_unique_id: 'uniq-album-downloaded',
        file_name: 'photo-downloaded.jpg',
        author: 'Retry Author',
        file_kind: 'photo',
        file_size: 1024,
        status: 'downloaded',
        local_path: '/tmp/photo-downloaded.jpg'
      }),
      createRepositoryRecord({
        id: 11,
        message_id: 2002,
        media_group_id: 'album-retry',
        file_id: 'photo-failed',
        file_unique_id: 'uniq-album-failed',
        file_name: 'photo-failed.jpg',
        author: 'Retry Author',
        file_kind: 'photo',
        file_size: 1024,
        status: 'download_failed',
        error_code: 'download_failed'
      })
    ]
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 66,
    message: createMessage({
      text: '/retry',
      reply_to_message: createMessage({
        message_id: 2002,
        media_group_id: 'album-retry',
        photo: [
          createTelegramFile('photo-failed', 'uniq-album-failed', 1024)
        ]
      })
    })
  });

  assert.strictEqual(result.reason, 'retry_media_group_processed');
  assert.deepStrictEqual(
    result.files.map((file) => file.status),
    ['duplicate_skipped', 'downloaded']
  );
  assert.strictEqual(deps.downloader.calls.length, 1);
  assert.strictEqual(deps.downloader.calls[0].file_unique_id, 'uniq-album-failed');
  assert.strictEqual(deps.downloader.calls[0].author, 'Retry Author');
  assert.deepStrictEqual(
    deps.messageDeleter.calls.map((call) => call.messageId),
    [2001, 2002]
  );
  assert.deepStrictEqual(
    deps.messageSender.calls.map((call) => call.text),
    [
      'Файл "photo-downloaded.jpg" уже был раньше.',
      'Файл "photo-failed.jpg" скачан: /tmp/photo-failed'
    ]
  );
}

async function testRetryCommandRejectsUnauthorizedRepliedMessage() {
  const deps = createMockDependencies();
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 65,
    message: createMessage({
      text: '/retry',
      reply_to_message: createMessage({
        message_id: 1005,
        from: { id: 999 },
        document: createTelegramFile('doc-unauthorized', 'uniq-retry-unauthorized', 1024)
      })
    })
  });

  assert.strictEqual(result.accepted, false);
  assert.strictEqual(result.reason, 'unauthorized_user');
  assert.deepStrictEqual(deps.downloader.calls, []);
  assert.deepStrictEqual(deps.messageDeleter.calls, []);
  assert.deepStrictEqual(deps.messageSender.calls, []);
}

async function testProcessingSendsSingleFileResponse() {
  const deps = createMockDependencies();
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 9,
    message: createMessage({
      document: createTelegramFile('doc-small', 'uniq-doc-small', 1024, {
        file_name: 'report.pdf'
      })
    })
  });

  assert.strictEqual(result.sendMessageCalled, true);
  assert.strictEqual(deps.messageSender.calls.length, 1);
  assert.strictEqual(deps.messageSender.calls[0].chatId, 5001);
  assert.strictEqual(
    deps.messageSender.calls[0].text,
    'Файл "report.pdf" скачан: /tmp/doc-small'
  );
  assert.deepStrictEqual(result.responseTexts, ['Файл "report.pdf" скачан: /tmp/doc-small']);
}

async function testProcessingSendsSeparateFileResponses() {
  const deps = createMockDependencies({
    existingFileUniqueIds: ['uniq-duplicate']
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 10,
    message: createMessage({
      document: createTelegramFile('doc-small', 'uniq-doc-small', 1024),
      video: createTelegramFile('video-large', 'uniq-video-large', DEFAULT_SMALL_FILE_LIMIT_BYTES + 1),
      photo: [
        createTelegramFile('photo-duplicate', 'uniq-duplicate', 1024)
      ]
    })
  });

  assert.strictEqual(result.sendMessageCalled, true);
  assert.strictEqual(deps.messageSender.calls.length, 3);
  assert.deepStrictEqual(
    deps.messageSender.calls.map((call) => call.text),
    [
      'Файл "file" скачан: /tmp/doc-small',
      'Файл "photo.jpg" уже был раньше.',
      'Файл "video" добавлен в очередь.'
    ]
  );
  assert.deepStrictEqual(result.responseTexts, deps.messageSender.calls.map((call) => call.text));
}

async function testProcessingResponseDoesNotWaitForQueuedSend() {
  const deps = createMockDependencies({
    blockSendMessage: true
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 56,
    message: createMessage({
      document: createTelegramFile('doc-small', 'uniq-doc-small-nonblocking', 1024)
    })
  });

  assert.strictEqual(result.sendMessageCalled, true);
  assert.strictEqual(result.sendMessageError, null);
  assert.strictEqual(deps.messageSender.calls.length, 1);
  assert.strictEqual(deps.pendingMessageSends.length, 1);

  deps.pendingMessageSends[0].resolve({ message_id: 9001 });
  await flushMicrotasks();
}

async function testProcessingResponseLogsAsyncSendFailure() {
  const errors = [];
  const deps = createMockDependencies({
    failSendMessage: true,
    logger: {
      error(message, fields) {
        errors.push({ message, fields });
      }
    }
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 57,
    message: createMessage({
      document: createTelegramFile('doc-small', 'uniq-doc-small-send-failed', 1024)
    })
  });

  await flushMicrotasks();

  assert.strictEqual(result.sendMessageCalled, true);
  assert.strictEqual(result.sendMessageError, null);
  assert.strictEqual(errors.some((entry) => entry.message === 'processing response send failed'), true);
}

async function testDeleteMessageFailureIsRecordedWithoutStatusOverwrite() {
  const deps = createMockDependencies({
    failDeleteMessage: true
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 22,
    message: createMessage({
      document: createTelegramFile('doc-small', 'uniq-doc-delete-failed', 1024)
    })
  });

  assert.strictEqual(result.deleteMessageCalled, true);
  assert.ok(result.deleteMessageError);
  assert.strictEqual(deps.fileRepository.records[0].status, 'downloaded');
  assert.strictEqual(deps.fileRepository.records[0].error_code, 'delete_message_failed');
  assert.strictEqual(deps.fileRepository.records[0].error_message, 'Cannot delete message');
  assert.strictEqual(deps.fileRepository.events.some((event) => event.event_type === 'delete_message_failed'), true);
}

async function testDeleteMessageRetriesTransientFailure() {
  const transientError = new Error('read ECONNRESET');
  transientError.code = 'ECONNRESET';
  const deps = createMockDependencies({
    deleteFailures: [transientError]
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 67,
    message: createMessage({
      document: createTelegramFile('doc-small', 'uniq-doc-delete-retry', 1024)
    })
  });

  assert.strictEqual(result.deleteMessageCalled, true);
  assert.strictEqual(result.deleteMessageError, null);
  assert.strictEqual(deps.messageDeleter.calls.length, 2);
  assert.strictEqual(deps.fileRepository.records[0].error_code, null);
  assert.strictEqual(deps.fileRepository.events.some((event) => event.event_type === 'delete_message_failed'), false);
}

async function testDeleteMessageNotFoundIsTreatedAsDeleted() {
  const deps = createMockDependencies({
    deleteFailures: [
      new Error('Telegram API deleteMessage failed: Bad Request: message to delete not found')
    ]
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 68,
    message: createMessage({
      document: createTelegramFile('doc-small', 'uniq-doc-delete-not-found', 1024)
    })
  });

  assert.strictEqual(result.deleteMessageCalled, true);
  assert.strictEqual(result.deleteMessageError, null);
  assert.strictEqual(deps.messageDeleter.calls.length, 1);
  assert.strictEqual(deps.fileRepository.records[0].error_code, null);
  assert.strictEqual(deps.fileRepository.events.some((event) => event.event_type === 'delete_message_failed'), false);
}

async function testMediaGroupSendsImmediateFileResponses() {
  const deps = createMockDependencies();
  const handler = createTelegramUpdateHandler(deps);

  const first = await handler.handleUpdate({
    update_id: 23,
    message: createMessage({
      media_group_id: 'album-1',
      document: createTelegramFile('doc-small-1', 'uniq-album-1', 1024)
    })
  });
  const second = await handler.handleUpdate({
    update_id: 24,
    message: createMessage({
      media_group_id: 'album-1',
      video: createTelegramFile('video-large-1', 'uniq-album-2', DEFAULT_SMALL_FILE_LIMIT_BYTES + 1)
    })
  });

  assert.strictEqual(first.responseDeferred, undefined);
  assert.strictEqual(second.responseDeferred, undefined);
  assert.strictEqual(deps.messageSender.calls.length, 2);
  assert.strictEqual(deps.fileRepository.records.length, 2);
  assert.deepStrictEqual(
    deps.messageSender.calls.map((call) => call.text),
    [
      'Файл "file" скачан: /tmp/doc-small-1',
      'Файл "video" добавлен в очередь.'
    ]
  );
}

async function testMediaGroupInheritsAuthorFromFirstCaption() {
  const deps = createMockDependencies();
  const handler = createTelegramUpdateHandler(deps);

  for (let index = 0; index < 4; index += 1) {
    await handler.handleUpdate({
      update_id: 70 + index,
      message: createMessage({
        message_id: 3001 + index,
        media_group_id: 'album-with-author',
        caption: index === 0 ? '⭐ Succulent Sauce (VIP)' : undefined,
        photo: [
          createTelegramFile(`album-photo-${index}`, `album-photo-unique-${index}`, 1024)
        ]
      })
    });
  }

  assert.deepStrictEqual(
    deps.downloader.calls.map((attachment) => attachment.author),
    ['Succulent Sauce', 'Succulent Sauce', 'Succulent Sauce', 'Succulent Sauce']
  );
  assert.deepStrictEqual(
    deps.fileRepository.records.map((record) => record.author),
    ['Succulent Sauce', 'Succulent Sauce', 'Succulent Sauce', 'Succulent Sauce']
  );
}

async function testMediaGroupCachesAuthorWhenCaptionFileIsDuplicate() {
  const deps = createMockDependencies({
    existingFileUniqueIds: ['duplicate-caption-file']
  });
  const handler = createTelegramUpdateHandler(deps);

  const first = await handler.handleUpdate({
    update_id: 74,
    message: createMessage({
      message_id: 3010,
      media_group_id: 'album-duplicate-first',
      caption: '💎 Cached Author (Member)',
      photo: [
        createTelegramFile('duplicate-photo', 'duplicate-caption-file', 1024)
      ]
    })
  });
  const second = await handler.handleUpdate({
    update_id: 75,
    message: createMessage({
      message_id: 3011,
      media_group_id: 'album-duplicate-first',
      photo: [
        createTelegramFile('new-photo', 'new-photo-after-duplicate', 1024)
      ]
    })
  });

  assert.strictEqual(first.files[0].status, 'duplicate_skipped');
  assert.strictEqual(second.files[0].status, 'downloaded');
  assert.strictEqual(deps.fileRepository.records.length, 1);
  assert.strictEqual(deps.fileRepository.records[0].author, 'Cached Author');
}

async function testMediaGroupRestoresAuthorFromRepository() {
  const deps = createMockDependencies({
    records: [
      createRepositoryRecord({
        id: 20,
        message_id: 3020,
        media_group_id: 'album-after-restart',
        file_id: 'saved-first-photo',
        file_unique_id: 'saved-first-photo-unique',
        file_kind: 'photo',
        file_size: 1024,
        author: 'Persisted Author',
        status: 'downloaded'
      })
    ]
  });
  const handler = createTelegramUpdateHandler(deps);

  await handler.handleUpdate({
    update_id: 76,
    message: createMessage({
      message_id: 3021,
      media_group_id: 'album-after-restart',
      photo: [
        createTelegramFile('second-photo', 'second-photo-after-restart', 1024)
      ]
    })
  });

  assert.strictEqual(deps.downloader.calls[0].author, 'Persisted Author');
  assert.strictEqual(deps.fileRepository.records[1].author, 'Persisted Author');
}

async function testSeparateMediaGroupsSendImmediateResponses() {
  const deps = createMockDependencies();
  const handler = createTelegramUpdateHandler(deps);

  await handler.handleUpdate({
    update_id: 25,
    message: createMessage({
      media_group_id: 'album-a',
      caption: '⭐ Album A Author (VIP)',
      document: createTelegramFile('doc-a', 'uniq-album-a', 1024)
    })
  });
  await handler.handleUpdate({
    update_id: 26,
    message: createMessage({
      media_group_id: 'album-b',
      document: createTelegramFile('doc-b', 'uniq-album-b', 1024)
    })
  });

  assert.strictEqual(deps.messageSender.calls.length, 2);
  assert.strictEqual(deps.messageSender.calls[0].text, 'Файл "file" скачан: /tmp/doc-a');
  assert.strictEqual(deps.messageSender.calls[1].text, 'Файл "file" скачан: /tmp/doc-b');
  assert.strictEqual(deps.fileRepository.records[0].author, 'Album A Author');
  assert.strictEqual(deps.fileRepository.records[1].author, null);
}

async function testShowQueueCommandShowsQueue() {
  const deps = createMockDependencies({
    manualQueue: [
      createRepositoryRecord({ queue_position: 1, file_name: 'big-video.mp4', file_size: 25 * 1024 * 1024, status: 'pending_manual_download' })
    ]
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 11,
    message: createMessage({ text: '/show_queue' })
  });

  assert.strictEqual(result.reason, 'show_queue_command');
  assert.strictEqual(deps.messageSender.calls.length, 1);
  assert.strictEqual(deps.messageSender.calls[0].text, 'В очереди файлов: 1. Суммарный объем: 25.0 МБ.');
  assert.deepStrictEqual(deps.messageSender.calls[0].replyMarkup.inline_keyboard[0][0].callback_data, CALLBACK_SHOW_NEXT_FILES);
  assert.deepStrictEqual(deps.messageSender.calls[0].replyMarkup.inline_keyboard[1][0].callback_data, CALLBACK_SHOW_LARGEST_FILES);
  assert.deepStrictEqual(deps.messageSender.calls[0].replyMarkup.inline_keyboard[1][1].callback_data, CALLBACK_SHOW_SMALLEST_FILES);
  assert.deepStrictEqual(deps.messageSender.calls[0].replyMarkup.inline_keyboard[2][0].callback_data, CALLBACK_SHOW_POSSIBLE_DUPLICATES);
}

async function testSearchQueueCommandShowsFilteredQueueAndButtons() {
  const deps = createMockDependencies({
    manualQueue: [
      createRepositoryRecord({ queue_position: 1, file_name: 'family-video.mp4', author: 'Report Keeper', file_size: 25 * 1024 * 1024, status: 'pending_manual_download' }),
      createRepositoryRecord({ queue_position: 2, file_name: 'other.pdf', file_size: 10 * 1024 * 1024, status: 'pending_manual_download' })
    ]
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 52,
    message: createMessage({ text: '/search_queue keeper' })
  });

  assert.strictEqual(result.reason, 'search_queue_command');
  assert.strictEqual(deps.messageSender.calls[0].text, 'Поиск в очереди по "keeper": В очереди файлов: 1. Суммарный объем: 25.0 МБ.');
  assert.strictEqual(deps.messageSender.calls[0].replyMarkup.inline_keyboard[0][0].text, 'Показать следующие вложения');
  assert.strictEqual(deps.messageSender.calls[0].replyMarkup.inline_keyboard[0][0].callback_data.startsWith('search_queue_next:'), true);
  assert.strictEqual(deps.messageSender.calls[0].replyMarkup.inline_keyboard[1][0].callback_data.startsWith('search_queue_largest:'), true);
  assert.strictEqual(deps.messageSender.calls[0].replyMarkup.inline_keyboard[1][1].callback_data.startsWith('search_queue_smallest:'), true);
  assert.strictEqual(deps.messageSender.calls[0].replyMarkup.inline_keyboard.length, 2);
}

async function testSearchQueueButtonShowsFilteredBatch() {
  const deps = createMockDependencies({
    pendingQueue: [
      createRepositoryRecord({ id: 41, queue_position: 1, file_name: 'family-video.mp4', author: 'Report Keeper', file_kind: 'video', file_id: 'video-file', file_size: 25 * 1024 * 1024, status: 'pending_manual_download' }),
      createRepositoryRecord({ id: 42, queue_position: 2, file_name: 'other.pdf', file_kind: 'document', file_id: 'doc-file', file_size: 10 * 1024 * 1024, status: 'pending_manual_download' })
    ],
    manualQueue: [
      createRepositoryRecord({ id: 41, queue_position: 1, file_name: 'family-video.mp4', author: 'Report Keeper', file_kind: 'video', file_id: 'video-file', file_size: 25 * 1024 * 1024, status: 'pending_manual_download' }),
      createRepositoryRecord({ id: 42, queue_position: 2, file_name: 'other.pdf', file_kind: 'document', file_id: 'doc-file', file_size: 10 * 1024 * 1024, status: 'pending_manual_download' })
    ]
  });
  const handler = createTelegramUpdateHandler(deps);

  await handler.handleUpdate({
    update_id: 53,
    message: createMessage({ text: '/search_queue keeper' })
  });

  const callbackData = deps.messageSender.calls[0].replyMarkup.inline_keyboard[0][0].callback_data;
  const result = await handler.handleUpdate({
    update_id: 54,
    callback_query: createCallbackQuery(callbackData)
  });

  assert.strictEqual(result.reason, 'search_queue_batch_shown');
  assert.strictEqual(deps.fileSender.calls.length, 1);
  assert.strictEqual(deps.fileSender.calls[0].method, 'sendVideo');
  assert.strictEqual(deps.fileSender.calls[0].fileId, 'video-file');
  assertFileActionsKeyboard(deps.fileSender.calls[0].replyMarkup);
  assert.deepStrictEqual(deps.fileRepository.confirmedIds, [41]);
}

async function testFileActionButtonsMoveSentFile() {
  const file = createRepositoryRecord({
    id: 43,
    file_id: 'button-file',
    file_unique_id: 'button-file-unique',
    file_kind: 'document',
    status: 'pending_manual_download'
  });
  const deps = createMockDependencies({
    pendingQueue: [file],
    manualQueue: [file]
  });
  const handler = createTelegramUpdateHandler(deps);

  await handler.handleUpdate({
    update_id: 58,
    callback_query: createCallbackQuery(CALLBACK_SHOW_LARGEST_FILES)
  });

  const sentMessage = {
    message_id: 3001,
    chat: { id: 5001 }
  };
  const queued = await handler.handleUpdate({
    update_id: 59,
    callback_query: createCallbackQuery(CALLBACK_RETURN_FILE_TO_QUEUE, {
      message: sentMessage
    })
  });
  const archived = await handler.handleUpdate({
    update_id: 60,
    callback_query: createCallbackQuery(CALLBACK_RETURN_FILE_TO_ARCHIVE, {
      message: sentMessage
    })
  });

  assert.strictEqual(queued.reason, 'file_returned_to_queue');
  assert.strictEqual(archived.reason, 'file_returned_to_archive');
  assert.deepStrictEqual(deps.fileRepository.queuedIds, [43]);
  assert.deepStrictEqual(deps.fileRepository.archivedIds, [43]);
  assert.strictEqual(deps.fileRepository.events.some((event) => event.event_type === 'returned_to_queue'), true);
  assert.strictEqual(deps.fileRepository.events.some((event) => event.event_type === 'archived'), true);
  assert.strictEqual(deps.messageSender.calls[1].text, 'Файл возвращен в очередь.');
  assert.strictEqual(deps.messageSender.calls[2].text, 'Файл перемещен в архив.');
}

async function testQueueCommandRequiresReply() {
  const deps = createMockDependencies();
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 36,
    message: createMessage({ text: '/queue' })
  });

  assert.strictEqual(result.reason, 'queue_reply_required');
  assert.strictEqual(deps.messageSender.calls[0].text, 'Отправьте /queue в ответ на медиа, которое прислал бот.');
}

async function testQueueCommandReportsUnknownReply() {
  const deps = createMockDependencies();
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 37,
    message: createMessage({
      text: '/queue',
      reply_to_message: {
        message_id: 7001
      }
    })
  });

  assert.strictEqual(result.reason, 'queue_file_not_found');
  assert.strictEqual(deps.messageSender.calls[0].text, 'Не удалось найти файл для этого сообщения.');
}

async function testQueueCommandReturnsReplyFileToQueue() {
  const file = createRepositoryRecord({ id: 42, status: 'download_confirmed' });
  const deps = createMockDependencies({
    sentFiles: [
      {
        fileRecordId: 42,
        chatId: 5001,
        sentMessageId: 7002,
        source: 'queue'
      }
    ],
    manualQueue: [file],
    pendingQueue: [file]
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 38,
    message: createMessage({
      text: '/queue',
      reply_to_message: {
        message_id: 7002
      }
    })
  });

  assert.strictEqual(result.reason, 'queue_return_command');
  assert.deepStrictEqual(deps.fileRepository.queuedIds, [42]);
  assert.strictEqual(deps.fileRepository.events.some((event) => event.event_type === 'returned_to_queue'), true);
  assert.strictEqual(deps.messageSender.calls[0].text, 'Файл возвращен в очередь.');
}

async function testArchiveCommandRequiresReply() {
  const deps = createMockDependencies();
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 31,
    message: createMessage({ text: '/archive' })
  });

  assert.strictEqual(result.reason, 'archive_reply_required');
  assert.strictEqual(deps.messageSender.calls[0].text, 'Отправьте /archive в ответ на медиа, которое прислал бот.');
}

async function testArchiveCommandReportsUnknownReply() {
  const deps = createMockDependencies();
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 32,
    message: createMessage({
      text: '/archive',
      reply_to_message: {
        message_id: 7001
      }
    })
  });

  assert.strictEqual(result.reason, 'archive_file_not_found');
  assert.strictEqual(deps.messageSender.calls[0].text, 'Не удалось найти файл для этого сообщения.');
}

async function testArchiveCommandMarksReplyFileArchived() {
  const file = createRepositoryRecord({ id: 41, status: 'download_confirmed' });
  const deps = createMockDependencies({
    sentFiles: [
      {
        fileRecordId: 41,
        chatId: 5001,
        sentMessageId: 7001,
        source: 'queue'
      }
    ],
    manualQueue: [file],
    pendingQueue: [file]
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 33,
    message: createMessage({
      text: '/archive',
      reply_to_message: {
        message_id: 7001
      }
    })
  });

  assert.strictEqual(result.reason, 'archive_command');
  assert.deepStrictEqual(deps.fileRepository.archivedIds, [41]);
  assert.strictEqual(deps.fileRepository.events.some((event) => event.event_type === 'archived'), true);
  assert.strictEqual(deps.messageSender.calls[0].text, 'Файл перемещен в архив.');
}

async function testShowArchiveCommandShowsArchiveSummary() {
  const deps = createMockDependencies({
    archiveSummary: {
      fileCount: 2,
      totalKnownSize: 30 * 1024 * 1024,
      unknownSizeFiles: 0
    }
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 34,
    message: createMessage({ text: '/show_archive' })
  });

  assert.strictEqual(result.reason, 'show_archive_command');
  assert.strictEqual(deps.messageSender.calls[0].text, 'В архиве файлов: 2. Суммарный объем: 30.0 МБ.');
  assert.strictEqual(deps.messageSender.calls[0].replyMarkup.inline_keyboard[0][0].callback_data, CALLBACK_SHOW_NEXT_ARCHIVE_FILES);
  assert.strictEqual(deps.messageSender.calls[0].replyMarkup.inline_keyboard[1][0].callback_data, CALLBACK_SHOW_LARGEST_ARCHIVE_FILES);
  assert.strictEqual(deps.messageSender.calls[0].replyMarkup.inline_keyboard[1][1].callback_data, CALLBACK_SHOW_SMALLEST_ARCHIVE_FILES);
  assert.strictEqual(deps.messageSender.calls[0].replyMarkup.inline_keyboard.length, 2);
}

async function testSearchArchiveCommandShowsFilteredArchiveAndButtons() {
  const deps = createMockDependencies({
    archiveQueue: [
      createRepositoryRecord({ queue_position: 1, file_name: 'archive-video.mp4', author: 'Report Keeper', file_size: 25 * 1024 * 1024, status: 'archived' }),
      createRepositoryRecord({ queue_position: 2, file_name: 'other.pdf', file_size: 10 * 1024 * 1024, status: 'archived' })
    ]
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 55,
    message: createMessage({ text: '/search_archive keeper' })
  });

  assert.strictEqual(result.reason, 'search_archive_command');
  assert.strictEqual(deps.messageSender.calls[0].text, 'Поиск в архиве по "keeper": В архиве файлов: 1. Суммарный объем: 25.0 МБ.');
  assert.strictEqual(deps.messageSender.calls[0].replyMarkup.inline_keyboard[0][0].text, 'Показать следующие вложения');
  assert.strictEqual(deps.messageSender.calls[0].replyMarkup.inline_keyboard[0][0].callback_data.startsWith('search_archive_next:'), true);
  assert.strictEqual(deps.messageSender.calls[0].replyMarkup.inline_keyboard[1][0].callback_data.startsWith('search_archive_largest:'), true);
  assert.strictEqual(deps.messageSender.calls[0].replyMarkup.inline_keyboard[1][1].callback_data.startsWith('search_archive_smallest:'), true);
  assert.strictEqual(deps.messageSender.calls[0].replyMarkup.inline_keyboard.length, 2);
}

async function testSearchDownloadedShowsDistinctBatchesWithoutChangingStatuses() {
  const downloadedFiles = [];

  for (let index = 1; index <= 12; index += 1) {
    downloadedFiles.push(createRepositoryRecord({
      id: 100 + index,
      queue_position: index,
      file_id: `downloaded-file-${index}`,
      file_unique_id: `downloaded-unique-${index}`,
      file_name: `keeper-${index}.bin`,
      author: 'Download Keeper',
      file_size: 1024 * 1024,
      file_kind: index % 3 === 0 ? 'video' : index % 2 === 0 ? 'photo' : 'document',
      status: index % 2 === 0 ? 'download_confirmed' : 'downloaded'
    }));
  }

  const deps = createMockDependencies({ downloadedFiles });
  const handler = createTelegramUpdateHandler(deps);
  const commandResult = await handler.handleUpdate({
    update_id: 551,
    message: createMessage({ text: '/search_downloaded keeper' })
  });

  assert.strictEqual(commandResult.reason, 'search_downloaded_command');
  assert.strictEqual(
    deps.messageSender.calls[0].text,
    'Поиск среди скачанных по "keeper": Скачанных файлов: 12. Суммарный объем: 12.0 МБ.'
  );
  assert.strictEqual(
    deps.messageSender.calls[0].replyMarkup.inline_keyboard[0][0].callback_data.startsWith('search_downloaded_next:'),
    true
  );
  assert.strictEqual(
    deps.messageSender.calls[0].replyMarkup.inline_keyboard[1][0].callback_data.startsWith('search_downloaded_largest:'),
    true
  );
  assert.strictEqual(
    deps.messageSender.calls[0].replyMarkup.inline_keyboard[1][1].callback_data.startsWith('search_downloaded_smallest:'),
    true
  );

  const callbackData = deps.messageSender.calls[0].replyMarkup.inline_keyboard[0][0].callback_data;
  const firstBatch = await handler.handleUpdate({
    update_id: 552,
    callback_query: createCallbackQuery(callbackData)
  });
  const secondBatch = await handler.handleUpdate({
    update_id: 553,
    callback_query: createCallbackQuery(callbackData)
  });

  assert.strictEqual(firstBatch.reason, 'search_downloaded_batch_shown');
  assert.strictEqual(secondBatch.reason, 'search_downloaded_batch_shown');
  assert.deepStrictEqual(
    deps.fileSender.calls.map((call) => call.fileId),
    downloadedFiles.map((file) => file.file_id)
  );
  deps.fileSender.calls.forEach((call) => assertFileActionsKeyboard(call.replyMarkup));
  assert.strictEqual(
    deps.messageSender.calls[1].text,
    'Показано скачанных файлов: 10. Статусы не изменены. Осталось найденных: 2.'
  );
  assert.strictEqual(
    deps.messageSender.calls[2].text,
    'Показано скачанных файлов: 2. Статусы не изменены. Осталось найденных: 0.'
  );
  assert.deepStrictEqual(deps.fileRepository.confirmedIds, []);
  assert.deepStrictEqual(
    deps.fileRepository.downloadedFiles.map((file) => file.status),
    downloadedFiles.map((file) => file.status)
  );
  assert.strictEqual(
    deps.fileRepository.sentFiles.every((sentFile) => sentFile.source === 'downloaded'),
    true
  );
}

async function testClearQueueCommandRequestsConfirmation() {
  const deps = createMockDependencies();
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 12,
    message: createMessage({ text: '/clear_queue' })
  });

  assert.strictEqual(result.reason, 'clear_queue_command');
  assert.strictEqual(deps.messageSender.calls.length, 1);
  assert.strictEqual(deps.messageSender.calls[0].replyMarkup.inline_keyboard[0][0].callback_data, CALLBACK_CONFIRM_CLEAR_QUEUE);
  assert.strictEqual(deps.messageSender.calls[0].replyMarkup.inline_keyboard[0][1].callback_data, CALLBACK_CANCEL_CLEAR_QUEUE);
}

async function testConfirmClearQueueMarksRecordsDeleted() {
  const deps = createMockDependencies({
    manualQueue: [
      createRepositoryRecord({ id: 1, status: 'pending_manual_download' }),
      createRepositoryRecord({ id: 2, status: 'shown_to_user' })
    ]
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 13,
    callback_query: createCallbackQuery(CALLBACK_CONFIRM_CLEAR_QUEUE)
  });

  assert.strictEqual(result.reason, 'clear_queue_confirmed');
  assert.strictEqual(deps.callbackResponder.calls.length, 1);
  assert.strictEqual(deps.fileRepository.deletedRecords.length, 2);
  assert.strictEqual(deps.messageSender.calls[0].text, 'Очередь очищена. Записей обновлено: 2.');
}

async function testUnauthorizedCallbackIsIgnored() {
  const deps = createMockDependencies();
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 14,
    callback_query: createCallbackQuery(CALLBACK_SHOW_NEXT_FILES, { from: { id: 999 } })
  });

  assert.strictEqual(result.accepted, false);
  assert.strictEqual(result.reason, 'unauthorized_callback');
  assert.deepStrictEqual(deps.callbackResponder.calls, []);
  assert.deepStrictEqual(deps.fileSender.calls, []);
}

async function testExpiredCallbackAnswerDoesNotBlockAction() {
  const warnings = [];
  const deps = createMockDependencies({
    pendingQueue: [
      createRepositoryRecord({
        id: 15,
        file_id: 'file-after-expired-callback',
        file_unique_id: 'unique-after-expired-callback',
        file_kind: 'photo'
      })
    ],
    logger: {
      warn(message, details) {
        warnings.push({ message, details });
      }
    }
  });
  const callbackError = new Error(
    'Telegram API answerCallbackQuery failed: Bad Request: query is too old and response timeout expired or query ID is invalid'
  );
  deps.callbackResponder.answerCallbackQuery = async function answerCallbackQuery(payload) {
    this.calls.push(payload);
    throw callbackError;
  };
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 141,
    callback_query: createCallbackQuery(CALLBACK_SHOW_NEXT_FILES)
  });

  assert.strictEqual(result.reason, 'manual_download_batch_shown');
  assert.deepStrictEqual(deps.fileRepository.confirmedIds, [15]);
  assert.deepStrictEqual(
    deps.fileSender.calls.map((call) => call.fileId),
    ['file-after-expired-callback']
  );
  assert.strictEqual(warnings.length, 1);
  assert.strictEqual(warnings[0].message, 'callback query answer expired; continuing');
  assert.strictEqual(warnings[0].details.callbackQueryId, `callback-${CALLBACK_SHOW_NEXT_FILES}`);
  assert.strictEqual(warnings[0].details.error, callbackError);
}

async function testUnexpectedCallbackAnswerFailureStopsAction() {
  const deps = createMockDependencies({
    pendingQueue: [
      createRepositoryRecord({
        id: 16,
        file_id: 'file-after-failed-callback',
        file_unique_id: 'unique-after-failed-callback',
        file_kind: 'photo'
      })
    ]
  });
  deps.callbackResponder.answerCallbackQuery = async function answerCallbackQuery(payload) {
    this.calls.push(payload);
    throw new Error('Telegram API answerCallbackQuery failed: Forbidden');
  };
  const handler = createTelegramUpdateHandler(deps);

  await assert.rejects(
    handler.handleUpdate({
      update_id: 142,
      callback_query: createCallbackQuery(CALLBACK_SHOW_NEXT_FILES)
    }),
    /answerCallbackQuery failed: Forbidden/
  );

  assert.deepStrictEqual(deps.fileRepository.confirmedIds, []);
  assert.deepStrictEqual(deps.fileSender.calls, []);
}

async function testShowNextFilesSendsAtMostTenAndMarksShown() {
  const pendingQueue = [];

  for (let index = 1; index <= 12; index += 1) {
    pendingQueue.push(createRepositoryRecord({
      id: index,
      file_kind: index === 1 ? 'document' : 'photo',
      queue_position: index,
      file_id: `file-${index}`,
      file_unique_id: `unique-${index}`
    }));
  }

  const deps = createMockDependencies({ pendingQueue });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 15,
    callback_query: createCallbackQuery(CALLBACK_SHOW_NEXT_FILES)
  });

  assert.strictEqual(result.reason, 'manual_download_batch_shown');
  assert.strictEqual(deps.fileSender.calls.length, 10);
  assert.strictEqual(deps.fileRepository.confirmedIds.length, 10);
  assert.deepStrictEqual(deps.fileRepository.shownIds, []);
  assert.strictEqual(deps.fileSender.calls[0].method, 'sendPhoto');
  assert.strictEqual(deps.fileSender.calls.some((call) => call.method === 'sendDocument'), false);
  deps.fileSender.calls.forEach((call) => assertFileActionsKeyboard(call.replyMarkup));
  assert.strictEqual(deps.messageSender.calls[0].replyMarkup.inline_keyboard[0][0].callback_data, CALLBACK_SHOW_NEXT_FILES);
  assert.strictEqual(deps.messageSender.calls[0].replyMarkup.inline_keyboard[0][0].text, 'Показать следующие вложения');
}

async function testManualDownloadUsesAuthorAsOnlyCaption() {
  const deps = createMockDependencies({
    pendingQueue: [
      createRepositoryRecord({ id: 1, file_id: 'photo-author', file_unique_id: 'photo-author-unique', file_size: 40, file_kind: 'photo', author: 'Dr Strange' }),
      createRepositoryRecord({ id: 2, file_id: 'video-author', file_unique_id: 'video-author-unique', file_size: 30, file_kind: 'video', author: 'Goblin Slayer' }),
      createRepositoryRecord({ id: 3, file_id: 'document-author', file_unique_id: 'document-author-unique', file_size: 20, file_kind: 'document', author: 'Boolean Availability' }),
      createRepositoryRecord({ id: 4, file_id: 'document-no-author', file_unique_id: 'document-no-author-unique', file_size: 10, file_kind: 'document' })
    ]
  });
  const handler = createTelegramUpdateHandler(deps);

  await handler.handleUpdate({
    update_id: 69,
    callback_query: createCallbackQuery(CALLBACK_SHOW_LARGEST_FILES)
  });

  assert.deepStrictEqual(
    deps.fileSender.calls.map((call) => ({
      method: call.method,
      fileId: call.fileId,
      caption: call.caption
    })),
    [
      { method: 'sendPhoto', fileId: 'photo-author', caption: 'Dr Strange' },
      { method: 'sendVideo', fileId: 'video-author', caption: 'Goblin Slayer' },
      { method: 'sendDocument', fileId: 'document-author', caption: 'Boolean Availability' },
      { method: 'sendDocument', fileId: 'document-no-author', caption: undefined }
    ]
  );
  assert.strictEqual(Object.prototype.hasOwnProperty.call(deps.fileSender.calls[3], 'caption'), false);
  deps.fileSender.calls.forEach((call) => assertFileActionsKeyboard(call.replyMarkup));
}

async function testShowLargestFilesUsesSizeDescendingOrder() {
  const deps = createMockDependencies({
    pendingQueue: [
      createRepositoryRecord({ id: 1, file_id: 'small-file', file_unique_id: 'small-unique', file_size: 5 * 1024 * 1024, file_kind: 'document' }),
      createRepositoryRecord({ id: 2, file_id: 'large-file', file_unique_id: 'large-unique', file_size: 50 * 1024 * 1024, file_kind: 'document' }),
      createRepositoryRecord({ id: 3, file_id: 'medium-file', file_unique_id: 'medium-unique', file_size: 20 * 1024 * 1024, file_kind: 'document' })
    ]
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 28,
    callback_query: createCallbackQuery(CALLBACK_SHOW_LARGEST_FILES)
  });

  assert.strictEqual(result.reason, 'manual_download_batch_shown');
  assert.deepStrictEqual(
    deps.fileSender.calls.map((call) => call.fileId),
    ['large-file', 'medium-file', 'small-file']
  );
  assert.deepStrictEqual(deps.fileRepository.lastPendingQueueOptions.orderBy, 'size_desc');
}

async function testShowSmallestFilesUsesSizeAscendingOrder() {
  const deps = createMockDependencies({
    pendingQueue: [
      createRepositoryRecord({ id: 1, file_id: 'large-file', file_unique_id: 'large-unique', file_size: 50 * 1024 * 1024, file_kind: 'document' }),
      createRepositoryRecord({ id: 2, file_id: 'unknown-file', file_unique_id: 'unknown-unique', file_size: null, file_kind: 'document' }),
      createRepositoryRecord({ id: 3, file_id: 'small-file', file_unique_id: 'small-unique', file_size: 5 * 1024 * 1024, file_kind: 'document' })
    ]
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 29,
    callback_query: createCallbackQuery(CALLBACK_SHOW_SMALLEST_FILES)
  });

  assert.strictEqual(result.reason, 'manual_download_batch_shown');
  assert.deepStrictEqual(
    deps.fileSender.calls.map((call) => call.fileId),
    ['small-file', 'large-file']
  );
  assert.deepStrictEqual(deps.fileRepository.lastPendingQueueOptions.orderBy, 'size_asc');
}

async function testShowPossibleDuplicatesSendsLargestAggregateGroup() {
  const deps = createMockDependencies({
    pendingQueue: [
      createRepositoryRecord({ id: 1, file_id: 'largest-unique-file', file_unique_id: 'largest-unique', file_size: 100, file_kind: 'document' }),
      createRepositoryRecord({ id: 2, file_id: 'small-dup-1', file_unique_id: 'small-dup-1-unique', file_size: 40, file_kind: 'document' }),
      createRepositoryRecord({ id: 3, file_id: 'large-dup-2', file_unique_id: 'large-dup-2-unique', file_size: 80, file_kind: 'video', queue_position: 3 }),
      createRepositoryRecord({ id: 4, file_id: 'large-dup-1', file_unique_id: 'large-dup-1-unique', file_size: 80, file_kind: 'photo', queue_position: 2 }),
      createRepositoryRecord({ id: 5, file_id: 'small-dup-2', file_unique_id: 'small-dup-2-unique', file_size: 40, file_kind: 'document' }),
      createRepositoryRecord({ id: 6, file_id: 'small-dup-3', file_unique_id: 'small-dup-3-unique', file_size: 40, file_kind: 'photo' }),
      createRepositoryRecord({ id: 7, file_id: 'small-dup-4', file_unique_id: 'small-dup-4-unique', file_size: 40, file_kind: 'video' }),
      createRepositoryRecord({ id: 8, file_id: 'small-dup-5', file_unique_id: 'small-dup-5-unique', file_size: 40, file_kind: 'document' })
    ]
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 56,
    callback_query: createCallbackQuery(CALLBACK_SHOW_POSSIBLE_DUPLICATES)
  });

  assert.strictEqual(result.reason, 'potential_duplicates_batch_shown');
  assert.deepStrictEqual(
    deps.fileSender.calls.map((call) => call.fileId),
    ['small-dup-1', 'small-dup-2', 'small-dup-3', 'small-dup-4', 'small-dup-5']
  );
  assert.deepStrictEqual(deps.fileRepository.confirmedIds, [2, 5, 6, 7, 8]);
  assert.deepStrictEqual(
    deps.fileRepository.sentFiles.map((sentFile) => sentFile.file_record_id),
    [2, 5, 6, 7, 8]
  );
  deps.fileSender.calls.forEach((call) => assertFileActionsKeyboard(call.replyMarkup));
  assert.strictEqual(deps.messageSender.calls[0].text, 'Показано возможных дубликатов: 5. Они отмечены как скачанные. Осталось групп: 1.');
}

async function testShowPossibleDuplicatesReportsEmptyQueue() {
  const deps = createMockDependencies({
    pendingQueue: [
      createRepositoryRecord({ id: 1, file_id: 'unique-file', file_unique_id: 'unique-file-unique', file_size: 100, file_kind: 'document' })
    ]
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 57,
    callback_query: createCallbackQuery(CALLBACK_SHOW_POSSIBLE_DUPLICATES)
  });

  assert.strictEqual(result.reason, 'potential_duplicates_empty');
  assert.strictEqual(deps.messageSender.calls[0].text, 'В очереди нет возможных дубликатов.');
  assert.deepStrictEqual(deps.fileSender.calls, []);
}

async function testShowNextFilesConfirmsPreviouslyShownFirst() {
  const deps = createMockDependencies({
    shownQueue: [
      createRepositoryRecord({ id: 20, status: 'shown_to_user' })
    ],
    pendingQueue: [
      createRepositoryRecord({ id: 21, file_kind: 'document', status: 'pending_manual_download' })
    ]
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 16,
    callback_query: createCallbackQuery(CALLBACK_SHOW_NEXT_FILES)
  });

  assert.strictEqual(result.confirmedCount, 1);
  assert.deepStrictEqual(deps.fileRepository.confirmedIds, [20, 21]);
  assert.deepStrictEqual(deps.fileRepository.shownIds, []);
  assert.strictEqual(deps.messageSender.calls[0].replyMarkup, undefined);
}

async function testShowNextFilesUsesQueueSummaryForRemainingCount() {
  const pendingQueue = [];

  for (let index = 1; index <= 10; index += 1) {
    pendingQueue.push(createRepositoryRecord({
      id: index,
      file_kind: 'photo',
      queue_position: index,
      file_id: `file-${index}`,
      file_unique_id: `unique-${index}`
    }));
  }

  const deps = createMockDependencies({
    pendingQueue,
    pendingSummary: {
      fileCount: 693,
      totalKnownSize: 120000 * 1024 * 1024,
      unknownSizeFiles: 0
    }
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 27,
    callback_query: createCallbackQuery(CALLBACK_SHOW_NEXT_FILES)
  });

  assert.strictEqual(result.reason, 'manual_download_batch_shown');
  assert.strictEqual(deps.messageSender.calls[0].text.includes('Осталось в очереди: 693.'), true);
  assert.strictEqual(deps.messageSender.calls[0].replyMarkup.inline_keyboard[0][0].text, 'Показать следующие вложения');
}

async function testShowNextFilesReportsEmptyQueue() {
  const deps = createMockDependencies();
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 17,
    callback_query: createCallbackQuery(CALLBACK_SHOW_NEXT_FILES)
  });

  assert.strictEqual(result.reason, 'manual_download_queue_empty');
  assert.strictEqual(deps.messageSender.calls[0].text, 'В очереди нет файлов для ручного скачивания.');
  assert.deepStrictEqual(deps.fileSender.calls, []);
}

async function testShowArchiveFilesSendsAndConfirmsArchivedFiles() {
  const deps = createMockDependencies({
    archiveQueue: [
      createRepositoryRecord({ id: 50, file_id: 'archived-photo', file_unique_id: 'archived-photo-unique', file_kind: 'photo', status: 'archived' }),
      createRepositoryRecord({ id: 51, file_id: 'archived-video', file_unique_id: 'archived-video-unique', file_kind: 'video', status: 'archived' })
    ]
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 35,
    callback_query: createCallbackQuery(CALLBACK_SHOW_NEXT_ARCHIVE_FILES)
  });

  assert.strictEqual(result.reason, 'archive_batch_shown');
  assert.deepStrictEqual(deps.fileRepository.confirmedIds, [50, 51]);
  assert.deepStrictEqual(
    deps.fileRepository.sentFiles.map((sentFile) => sentFile.source),
    ['archive', 'archive']
  );
  assert.deepStrictEqual(
    deps.fileRepository.sentFiles.map((sentFile) => sentFile.file_record_id),
    [50, 51]
  );
  deps.fileSender.calls.forEach((call) => assertFileActionsKeyboard(call.replyMarkup));
  assert.strictEqual(deps.messageSender.calls[0].text, 'Показано вложений из архива: 2. Они отмечены как скачанные. Осталось в архиве: 0.');
}

async function testSendFailureMarksOnlyFailedFile() {
  const deps = createMockDependencies({
    pendingQueue: [
      createRepositoryRecord({ id: 30, file_id: 'ok-file', file_unique_id: 'ok-unique', file_kind: 'photo' }),
      createRepositoryRecord({ id: 31, file_id: 'bad-file', file_unique_id: 'bad-unique', file_kind: 'video' })
    ],
    failingFileIds: ['bad-file']
  });
  const handler = createTelegramUpdateHandler(deps);

  const result = await handler.handleUpdate({
    update_id: 18,
    callback_query: createCallbackQuery(CALLBACK_SHOW_NEXT_FILES)
  });

  assert.deepStrictEqual(deps.fileRepository.confirmedIds, [30]);
  assert.deepStrictEqual(deps.fileRepository.sendFailedIds, [31]);
  assert.strictEqual(result.failedFiles.length, 1);
  assert.strictEqual(result.files.length, 1);
}

function createMockDependencies(options) {
  const normalizedOptions = options || {};
  const existingFileUniqueIds = new Set(normalizedOptions.existingFileUniqueIds || []);
  const failingFileIds = new Set(normalizedOptions.failingFileIds || []);
  const failingDownloadFileIds = new Set(normalizedOptions.failingDownloadFileIds || []);
  const remainingDownloadFailuresByFileId = Object.assign({}, normalizedOptions.downloadFailuresByFileId || {});
  const deleteFailures = Array.isArray(normalizedOptions.deleteFailures)
    ? normalizedOptions.deleteFailures.slice()
    : [];
  let queuePosition = 0;
  const pendingMessageSends = [];
  const downloadRetryDelays = [];

  const fileRepository = {
    records: normalizedOptions.records || [],
    pendingQueue: normalizedOptions.pendingQueue || [],
    manualQueue: normalizedOptions.manualQueue || normalizedOptions.pendingQueue || [],
    archiveQueue: normalizedOptions.archiveQueue || [],
    downloadedFiles: normalizedOptions.downloadedFiles || [],
    queueSummary: normalizedOptions.queueSummary || null,
    pendingSummary: normalizedOptions.pendingSummary || null,
    potentialDuplicateSummary: normalizedOptions.potentialDuplicateSummary || null,
    archiveSummary: normalizedOptions.archiveSummary || null,
    shownQueue: normalizedOptions.shownQueue || [],
    lastPendingQueueOptions: null,
    shownIds: [],
    confirmedIds: [],
    archivedIds: [],
    queuedIds: [],
    sendFailedIds: [],
    deletedRecords: [],
    deleteFailedIds: [],
    metaCounters: {},
    events: [],
    sentFiles: normalizedOptions.sentFiles || [],
    async findByFileUniqueId(fileUniqueId) {
      if (existingFileUniqueIds.has(fileUniqueId)) {
        return { id: 9001, file_unique_id: fileUniqueId };
      }

      return this.records.find((record) => record.file_unique_id === fileUniqueId) || null;
    },
    async findDeduplicationRecordByFileUniqueId(fileUniqueId) {
      if (existingFileUniqueIds.has(fileUniqueId)) {
        return { id: 9001, file_unique_id: fileUniqueId, status: 'downloaded' };
      }

      return this.records.find((record) => (
        record.file_unique_id === fileUniqueId && record.status !== 'download_failed'
      )) || null;
    },
    async findFilesByMediaGroup(chatId, mediaGroupId) {
      return this.records
        .filter((record) => record.chat_id === chatId && record.media_group_id === mediaGroupId)
        .sort((left, right) => {
          if (left.message_id !== right.message_id) {
            return left.message_id - right.message_id;
          }

          return left.id - right.id;
        });
    },
    async create(record) {
      const created = Object.assign({ id: this.records.length + 1 }, record);
      this.records.push(created);
      return created;
    },
    async createFileEvent(event) {
      const created = Object.assign({ id: this.events.length + 1 }, event);
      this.events.push(created);
      return created;
    },
    async createSentFile(sentFile) {
      const created = Object.assign({ id: this.sentFiles.length + 1 }, sentFile);
      this.sentFiles.push(created);
      return created;
    },
    async findFileBySentMessage(chatId, sentMessageId) {
      const sentFile = this.sentFiles.find((item) => (
        item.chat_id === chatId && item.sent_message_id === sentMessageId
      )) || this.sentFiles.find((item) => (
        item.chatId === chatId && item.sentMessageId === sentMessageId
      ));

      if (!sentFile) {
        return null;
      }

      const recordId = sentFile.file_record_id || sentFile.fileRecordId;
      return this.records
        .concat(this.pendingQueue)
        .concat(this.manualQueue)
        .concat(this.archiveQueue)
        .concat(this.downloadedFiles)
        .find((record) => record.id === recordId) || null;
    },
    async incrementMetaCounter(key, incrementBy) {
      const increment = Number.isInteger(incrementBy) ? incrementBy : 1;
      this.metaCounters[key] = (this.metaCounters[key] || 0) + increment;
      return {
        key,
        value: String(this.metaCounters[key])
      };
    },
    async getManualDownloadQueue() {
      return this.manualQueue.filter((record) => record.status !== 'deleted_by_user');
    },
    async getManualDownloadQueueSummary() {
      if (this.queueSummary) {
        return this.queueSummary;
      }

      const active = this.manualQueue.filter((record) => ['pending_manual_download', 'pending_size_unknown', 'shown_to_user'].includes(record.status));
      return {
        fileCount: active.length,
        totalKnownSize: active.reduce((sum, record) => (
          Number.isFinite(record.file_size) ? sum + record.file_size : sum
        ), 0),
        unknownSizeFiles: active.filter((record) => !Number.isFinite(record.file_size)).length
      };
    },
    async getPendingManualDownloadSummary() {
      if (this.pendingSummary) {
        return this.pendingSummary;
      }

      const pending = this.manualQueue.filter((record) => ['pending_manual_download', 'pending_size_unknown'].includes(record.status));
      return {
        fileCount: pending.length,
        totalKnownSize: pending.reduce((sum, record) => (
          Number.isFinite(record.file_size) ? sum + record.file_size : sum
        ), 0),
        unknownSizeFiles: pending.filter((record) => !Number.isFinite(record.file_size)).length
      };
    },
    async searchManualDownloadQueueSummary(searchTerm) {
      const active = filterByFileNameOrAuthor(
        this.manualQueue.filter((record) => ['pending_manual_download', 'pending_size_unknown', 'shown_to_user'].includes(record.status)),
        searchTerm
      );
      return buildMockSummary(active);
    },
    async searchPendingManualDownloadSummary(searchTerm) {
      const pending = filterByFileNameOrAuthor(
        this.manualQueue.filter((record) => ['pending_manual_download', 'pending_size_unknown'].includes(record.status)),
        searchTerm
      );
      return buildMockSummary(pending);
    },
    async getPendingManualDownloadQueue(options) {
      const limit = options && options.limit ? options.limit : 10;
      const orderBy = options && options.orderBy ? options.orderBy : 'queue';
      this.lastPendingQueueOptions = options || {};

      if (orderBy === 'size_desc' || orderBy === 'size_asc') {
        return this.pendingQueue
          .filter((record) => record.status === 'pending_manual_download' && Number.isFinite(record.file_size))
          .slice()
          .sort((left, right) => (
            orderBy === 'size_desc'
              ? right.file_size - left.file_size
              : left.file_size - right.file_size
          ))
          .slice(0, limit);
      }

      const media = this.pendingQueue.filter((record) => record.status === 'pending_manual_download' && ['photo', 'video'].includes(record.file_kind));

      if (media.length > 0) {
        return media.slice(0, limit);
      }

      return this.pendingQueue.filter((record) => record.status === 'pending_manual_download' && record.file_kind === 'document').slice(0, limit);
    },
    async getPotentialDuplicateQueueGroup() {
      const duplicateGroups = getPotentialDuplicateGroups(this.pendingQueue);
      const largestGroup = duplicateGroups[0];

      return largestGroup ? largestGroup.records : [];
    },
    async getPotentialDuplicateQueueGroupSummary() {
      if (this.potentialDuplicateSummary) {
        return this.potentialDuplicateSummary;
      }

      const duplicateGroups = getPotentialDuplicateGroups(this.pendingQueue);
      return {
        groupCount: duplicateGroups.length,
        fileCount: duplicateGroups.reduce((sum, group) => sum + group.records.length, 0)
      };
    },
    async searchPendingManualDownloadQueue(searchTerm, options) {
      const limit = options && options.limit ? options.limit : 10;
      const orderBy = options && options.orderBy ? options.orderBy : 'queue';
      const matching = filterByFileNameOrAuthor(this.pendingQueue, searchTerm);

      if (orderBy === 'size_desc' || orderBy === 'size_asc') {
        return matching
          .filter((record) => record.status === 'pending_manual_download' && Number.isFinite(record.file_size))
          .slice()
          .sort((left, right) => (
            orderBy === 'size_desc'
              ? right.file_size - left.file_size
              : left.file_size - right.file_size
          ))
          .slice(0, limit);
      }

      const media = matching.filter((record) => record.status === 'pending_manual_download' && ['photo', 'video'].includes(record.file_kind));

      if (media.length > 0) {
        return media.slice(0, limit);
      }

      return matching.filter((record) => record.status === 'pending_manual_download' && record.file_kind === 'document').slice(0, limit);
    },
    async getArchiveQueue(options) {
      const limit = options && options.limit ? options.limit : 10;
      const orderBy = options && options.orderBy ? options.orderBy : 'queue';

      if (orderBy === 'size_desc' || orderBy === 'size_asc') {
        return this.archiveQueue
          .filter((record) => record.status === 'archived' && Number.isFinite(record.file_size))
          .slice()
          .sort((left, right) => (
            orderBy === 'size_desc'
              ? right.file_size - left.file_size
              : left.file_size - right.file_size
          ))
          .slice(0, limit);
      }

      const media = this.archiveQueue.filter((record) => record.status === 'archived' && ['photo', 'video'].includes(record.file_kind));

      if (media.length > 0) {
        return media.slice(0, limit);
      }

      return this.archiveQueue.filter((record) => record.status === 'archived' && record.file_kind === 'document').slice(0, limit);
    },
    async searchArchiveQueue(searchTerm, options) {
      const limit = options && options.limit ? options.limit : 10;
      const orderBy = options && options.orderBy ? options.orderBy : 'queue';
      const matching = filterByFileNameOrAuthor(this.archiveQueue, searchTerm);

      if (orderBy === 'size_desc' || orderBy === 'size_asc') {
        return matching
          .filter((record) => record.status === 'archived' && Number.isFinite(record.file_size))
          .slice()
          .sort((left, right) => (
            orderBy === 'size_desc'
              ? right.file_size - left.file_size
              : left.file_size - right.file_size
          ))
          .slice(0, limit);
      }

      const media = matching.filter((record) => record.status === 'archived' && ['photo', 'video'].includes(record.file_kind));

      if (media.length > 0) {
        return media.slice(0, limit);
      }

      return matching.filter((record) => record.status === 'archived' && record.file_kind === 'document').slice(0, limit);
    },
    async getArchiveSummary() {
      if (this.archiveSummary) {
        return this.archiveSummary;
      }

      const archived = this.archiveQueue.filter((record) => record.status === 'archived');
      return {
        fileCount: archived.length,
        totalKnownSize: archived.reduce((sum, record) => (
          Number.isFinite(record.file_size) ? sum + record.file_size : sum
        ), 0),
        unknownSizeFiles: archived.filter((record) => !Number.isFinite(record.file_size)).length
      };
    },
    async searchArchiveSummary(searchTerm) {
      const archived = filterByFileNameOrAuthor(this.archiveQueue.filter((record) => record.status === 'archived'), searchTerm);
      return buildMockSummary(archived);
    },
    async searchDownloadedFiles(searchTerm, options) {
      const normalizedSearchOptions = options || {};
      const limit = normalizedSearchOptions.limit || 10;
      const orderBy = normalizedSearchOptions.orderBy || 'queue';
      const excludedRecordIds = new Set(normalizedSearchOptions.excludedRecordIds || []);
      const matching = filterByFileNameOrAuthor(
        this.downloadedFiles.filter((record) => (
          ['downloaded', 'download_confirmed'].includes(record.status)
          && !excludedRecordIds.has(record.id)
        )),
        searchTerm
      );

      if (orderBy === 'size_desc' || orderBy === 'size_asc') {
        return matching
          .filter((record) => Number.isFinite(record.file_size))
          .slice()
          .sort((left, right) => (
            orderBy === 'size_desc'
              ? right.file_size - left.file_size || compareQueueOrder(left, right)
              : left.file_size - right.file_size || compareQueueOrder(left, right)
          ))
          .slice(0, limit);
      }

      return matching.slice().sort(compareQueueOrder).slice(0, limit);
    },
    async searchDownloadedSummary(searchTerm, options) {
      const normalizedSearchOptions = options || {};
      const excludedRecordIds = new Set(normalizedSearchOptions.excludedRecordIds || []);
      const matching = filterByFileNameOrAuthor(
        this.downloadedFiles.filter((record) => (
          ['downloaded', 'download_confirmed'].includes(record.status)
          && !excludedRecordIds.has(record.id)
        )),
        searchTerm
      );

      return buildMockSummary(matching);
    },
    async getShownToUserFiles() {
      return this.shownQueue;
    },
    async getStats() {
      return normalizedOptions.stats || {
        totalFiles: 0,
        totalKnownSize: 0,
        activeQueueFiles: 0,
        activeQueueKnownSize: 0,
        downloadedFiles: 0,
        downloadConfirmedFiles: 0,
        duplicateFiles: 0,
        failedFiles: 0,
        documentFiles: 0,
        photoFiles: 0,
        videoFiles: 0,
        unknownSizeFiles: 0
      };
    },
    async getStatsImageData() {
      return normalizedOptions.statsImageData || {
        stats: await this.getStats(),
        sizeBuckets: {},
        kindCounts: {
          document: 0,
          photo: 0,
          video: 0
        },
        statusCounts: {
          downloaded: 0,
          queue: 0,
          confirmed: 0,
          failed: 0
        }
      };
    },
    async markFilesAsShownToUser(recordIds) {
      this.shownIds.push(...recordIds);
      this.pendingQueue = this.pendingQueue.map((record) => (
        recordIds.includes(record.id) ? Object.assign({}, record, { status: 'shown_to_user' }) : record
      ));
      this.manualQueue = this.manualQueue.map((record) => (
        recordIds.includes(record.id) ? Object.assign({}, record, { status: 'shown_to_user' }) : record
      ));
      return recordIds.map((id) => Object.assign({}, this.pendingQueue.find((record) => record.id === id), { id, status: 'shown_to_user' }));
    },
    async markFilesAsDownloadConfirmed(recordIds) {
      this.confirmedIds.push(...recordIds);
      this.pendingQueue = this.pendingQueue.map((record) => (
        recordIds.includes(record.id) ? Object.assign({}, record, { status: 'download_confirmed' }) : record
      ));
      this.manualQueue = this.manualQueue.map((record) => (
        recordIds.includes(record.id) ? Object.assign({}, record, { status: 'download_confirmed' }) : record
      ));
      this.archiveQueue = this.archiveQueue.map((record) => (
        recordIds.includes(record.id) ? Object.assign({}, record, { status: 'download_confirmed' }) : record
      ));
      this.shownQueue = this.shownQueue.filter((record) => !recordIds.includes(record.id));
      return recordIds.map((id) => Object.assign(
        {},
        this.pendingQueue.find((record) => record.id === id) || this.archiveQueue.find((record) => record.id === id),
        { id, status: 'download_confirmed' }
      ));
    },
    async markFilesAsArchived(recordIds) {
      this.archivedIds.push(...recordIds);
      this.pendingQueue = this.pendingQueue.map((record) => (
        recordIds.includes(record.id) ? Object.assign({}, record, { status: 'archived', download_confirmed_at: null }) : record
      ));
      this.manualQueue = this.manualQueue.map((record) => (
        recordIds.includes(record.id) ? Object.assign({}, record, { status: 'archived', download_confirmed_at: null }) : record
      ));
      this.archiveQueue = this.archiveQueue.map((record) => (
        recordIds.includes(record.id) ? Object.assign({}, record, { status: 'archived', download_confirmed_at: null }) : record
      ));
      this.downloadedFiles = this.downloadedFiles.map((record) => (
        recordIds.includes(record.id) ? Object.assign({}, record, { status: 'archived', download_confirmed_at: null }) : record
      ));
      return recordIds.map((id) => Object.assign(
        {},
        this.pendingQueue.find((record) => record.id === id) ||
          this.manualQueue.find((record) => record.id === id) ||
          this.archiveQueue.find((record) => record.id === id) ||
          this.downloadedFiles.find((record) => record.id === id),
        { id, status: 'archived', download_confirmed_at: null }
      ));
    },
    async markFilesAsQueued(recordIds) {
      this.queuedIds.push(...recordIds);
      const updateRecord = (record) => {
        if (!recordIds.includes(record.id)) {
          return record;
        }

        return Object.assign({}, record, {
          status: Number.isFinite(record.file_size) ? 'pending_manual_download' : 'pending_size_unknown',
          download_confirmed_at: null,
          shown_at: null
        });
      };
      this.pendingQueue = this.pendingQueue.map(updateRecord);
      this.manualQueue = this.manualQueue.map(updateRecord);
      this.archiveQueue = this.archiveQueue.map(updateRecord);
      this.downloadedFiles = this.downloadedFiles.map(updateRecord);
      return recordIds.map((id) => {
        const record = this.pendingQueue.find((item) => item.id === id) ||
          this.manualQueue.find((item) => item.id === id) ||
          this.archiveQueue.find((item) => item.id === id) ||
          this.downloadedFiles.find((item) => item.id === id);

        return Object.assign({}, record, {
          id,
          status: record && Number.isFinite(record.file_size) ? 'pending_manual_download' : 'pending_size_unknown',
          download_confirmed_at: null,
          shown_at: null
        });
      });
    },
    async markFilesAsSendFailed(recordIds) {
      this.sendFailedIds.push(...recordIds);
      return recordIds.map((id) => ({ id, status: 'send_failed' }));
    },
    async markFilesDeleteMessageFailed(recordIds, error) {
      this.deleteFailedIds.push(...recordIds);
      const errorMessage = error && error.message ? error.message : String(error || 'delete_message_failed');
      this.records = this.records.map((record) => (
        recordIds.includes(record.id)
          ? Object.assign({}, record, {
            error_code: 'delete_message_failed',
            error_message: errorMessage
          })
          : record
      ));
      return this.records.filter((record) => recordIds.includes(record.id));
    },
    async markActiveQueueAsDeletedByUser() {
      this.deletedRecords = this.manualQueue.filter((record) => ['pending_manual_download', 'pending_size_unknown', 'shown_to_user'].includes(record.status));
      this.manualQueue = this.manualQueue.map((record) => (
        this.deletedRecords.includes(record) ? Object.assign({}, record, { status: 'deleted_by_user' }) : record
      ));
      return this.deletedRecords;
    }
  };

  const downloader = {
    calls: [],
    async download(attachment) {
      this.calls.push(attachment);

      if (remainingDownloadFailuresByFileId[attachment.file_id] > 0) {
        remainingDownloadFailuresByFileId[attachment.file_id] -= 1;
        throw new Error(`Cannot download ${attachment.file_id}`);
      }

      if (failingDownloadFileIds.has(attachment.file_id)) {
        throw new Error(`Cannot download ${attachment.file_id}`);
      }

      return { localPath: `/tmp/${attachment.file_id}` };
    }
  };

  const messageDeleter = {
    calls: [],
    async deleteMessage(payload) {
      this.calls.push(payload);

      if (deleteFailures.length > 0) {
        throw deleteFailures.shift();
      }

      if (normalizedOptions.failDeleteMessage) {
        throw new Error('Cannot delete message');
      }
    }
  };

  const messageSender = {
    calls: [],
    async sendMessage(payload) {
      this.calls.push(payload);

      if (normalizedOptions.failSendMessage) {
        throw new Error('Cannot send message');
      }

      if (normalizedOptions.blockSendMessage) {
        return new Promise((resolve, reject) => {
          pendingMessageSends.push({ resolve, reject });
        });
      }
    }
  };

  const fileSender = {
    calls: [],
    async sendPhoto(payload) {
      failIfConfigured(payload.fileId);
      this.calls.push(Object.assign({ method: 'sendPhoto' }, payload));
      return { message_id: 3000 + this.calls.length };
    },
    async sendVideo(payload) {
      failIfConfigured(payload.fileId);
      this.calls.push(Object.assign({ method: 'sendVideo' }, payload));
      return { message_id: 3000 + this.calls.length };
    },
    async sendDocument(payload) {
      failIfConfigured(payload.fileId);
      this.calls.push(Object.assign({ method: 'sendDocument' }, payload));
      return { message_id: 3000 + this.calls.length };
    }
  };

  const statsImageRenderer = {
    calls: [],
    async renderStatsImage(data) {
      this.calls.push(data);
      return normalizedOptions.statsImageBuffer || Buffer.from('png');
    }
  };

  const callbackResponder = {
    calls: [],
    async answerCallbackQuery(payload) {
      this.calls.push(payload);
    }
  };

  return {
    authorizedUserIds: [42, 77],
    smallFileLimitBytes: DEFAULT_SMALL_FILE_LIMIT_BYTES,
    fileRepository,
    downloader,
    messageDeleter,
    messageSender,
    fileSender,
    statsImageRenderer,
    callbackResponder,
    pendingMessageSends,
    downloadRetryDelays,
    nextQueuePosition: async () => {
      queuePosition += 1;
      return queuePosition;
    },
    downloadMaxAttempts: normalizedOptions.downloadMaxAttempts,
    downloadRetryDelayMs: normalizedOptions.downloadRetryDelayMs,
    downloadRetryDelay: async (ms) => {
      downloadRetryDelays.push(ms);
    },
    logger: normalizedOptions.logger || { error() {} },
    now: () => '2026-05-16T10:00:00.000Z'
  };

  function failIfConfigured(fileId) {
    if (failingFileIds.has(fileId)) {
      throw new Error(`Cannot send ${fileId}`);
    }
  }
}

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

function filterByFileNameOrAuthor(records, searchTerm) {
  const needle = String(searchTerm || '').trim().toLowerCase();

  if (!needle) {
    return [];
  }

  return records.filter((record) => (
    String(record.file_name || '').toLowerCase().includes(needle)
    || String(record.author || '').toLowerCase().includes(needle)
  ));
}

function getPotentialDuplicateGroups(records) {
  const groupsBySize = new Map();

  records
    .filter((record) => record.status === 'pending_manual_download' && Number.isFinite(record.file_size))
    .forEach((record) => {
      const group = groupsBySize.get(record.file_size) || [];
      group.push(record);
      groupsBySize.set(record.file_size, group);
    });

  return Array.from(groupsBySize.entries())
    .filter((entry) => entry[1].length >= 2)
    .map((entry) => ({
      fileSize: entry[0],
      records: entry[1].slice().sort(compareQueueOrder)
    }))
    .sort((left, right) => {
      const totalSizeDifference = (right.fileSize * right.records.length) - (left.fileSize * left.records.length);

      return totalSizeDifference || right.fileSize - left.fileSize;
    });
}

function compareQueueOrder(left, right) {
  if (left.queue_position !== right.queue_position) {
    return left.queue_position - right.queue_position;
  }

  if (left.received_at !== right.received_at) {
    return String(left.received_at || '').localeCompare(String(right.received_at || ''));
  }

  return left.id - right.id;
}

function buildMockSummary(records) {
  return {
    fileCount: records.length,
    totalKnownSize: records.reduce((sum, record) => (
      Number.isFinite(record.file_size) ? sum + record.file_size : sum
    ), 0),
    unknownSizeFiles: records.filter((record) => !Number.isFinite(record.file_size)).length
  };
}

function createMessage(overrides) {
  return Object.assign({
    message_id: 1001,
    media_group_id: null,
    chat: { id: 5001 },
    from: { id: 42 }
  }, overrides || {});
}

function createFakeTimers() {
  const scheduled = [];
  const cleared = [];
  let nextId = 1;

  return {
    dependencies: {
      setTimeoutFn(callback) {
        const timer = {
          id: nextId,
          callback
        };
        nextId += 1;
        scheduled.push(timer);
        return timer.id;
      },
      clearTimeoutFn(timerId) {
        cleared.push(timerId);
      }
    },
    cleared,
    async flushLatest() {
      const active = scheduled.filter((timer) => !cleared.includes(timer.id));
      const timer = active[active.length - 1];

      if (timer) {
        await timer.callback();
      }
    },
    async flushAt(index) {
      const active = scheduled.filter((timer) => !cleared.includes(timer.id));
      const timer = active[index];

      if (timer) {
        await timer.callback();
      }
    }
  };
}

function createTelegramFile(fileId, fileUniqueId, fileSize, overrides) {
  const file = Object.assign({
    file_id: fileId,
    file_unique_id: fileUniqueId
  }, overrides || {});

  if (fileSize !== undefined) {
    file.file_size = fileSize;
  }

  return file;
}

function createCallbackQuery(data, overrides) {
  return Object.assign({
    id: `callback-${data}`,
    from: { id: 42 },
    data,
    message: {
      message_id: 2001,
      chat: { id: 5001 }
    }
  }, overrides || {});
}

function assertFileActionsKeyboard(replyMarkup) {
  assert.deepStrictEqual(replyMarkup, {
    inline_keyboard: [
      [
        {
          text: 'Вернуть в очередь',
          callback_data: CALLBACK_RETURN_FILE_TO_QUEUE
        },
        {
          text: 'Вернуть в архив',
          callback_data: CALLBACK_RETURN_FILE_TO_ARCHIVE
        }
      ]
    ]
  });
}

function createRepositoryRecord(overrides) {
  return Object.assign({
    id: 1,
    authorized_user_id: 42,
    chat_id: 5001,
    message_id: 1001,
    file_id: 'repo-file-1',
    file_unique_id: 'repo-unique-1',
    file_name: 'file.bin',
    author: null,
    mime_type: 'application/octet-stream',
    file_size: 25 * 1024 * 1024,
    file_kind: 'document',
    deduplication_key: 'repo-unique-1',
    queue_position: 1,
    status: 'pending_manual_download',
    received_at: '2026-05-16T10:00:00.000Z'
  }, overrides || {});
}

module.exports = {
  runTests
};
