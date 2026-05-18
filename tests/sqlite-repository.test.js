'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createSqliteClient } = require('../src/adapters/sqlite/sqlite-client');
const { createTelegramUserFilesRepository } = require('../src/adapters/sqlite/telegram-user-files-repository');

function runTests() {
  testCreateRecordPersistsMetadata();
  testFindByFileUniqueIdReturnsExistingRecord();
  testPendingManualDownloadQueuePrioritizesPhotoAndVideo();
  testPendingManualDownloadQueueCanSortByLargestKnownSize();
  testPendingManualDownloadQueueCanSortBySmallestKnownSize();
  testPendingManualDownloadQueueIsGlobalAcrossUsers();
  testPendingManualDownloadQueueFallsBackToDocuments();
  testManualDownloadQueueIncludesActiveStatuses();
  testManualDownloadQueueSummaryIsNotLimited();
  testPendingManualDownloadSummaryExcludesShownRecords();
  testGetShownToUserFilesReturnsShownRecords();
  testGetStatsAggregatesFiles();
  testGetStatsUsesMetaDuplicateCounterAndDeleteFailures();
  testIncrementMetaCounterCreatesAndUpdatesCounter();
  testGetNextQueuePositionUsesExistingMaximum();
  testMarkFilesAsShownToUserUpdatesPendingRecords();
  testMarkFilesAsDownloadConfirmedUpdatesShownRecords();
  testMarkFilesAsSendFailedStoresError();
  testMarkFilesDeleteMessageFailedKeepsStatus();
  testMarkActiveQueueAsDeletedByUserKeepsHistory();
  testCreateFileEventPersistsAuditRecord();
}

function testCreateRecordPersistsMetadata() {
  withRepository((repository) => {
    const created = repository.create(createRecord({
      file_id: 'doc-1',
      file_unique_id: 'unique-doc-1',
      file_name: 'report.pdf',
      file_kind: 'document',
      file_size: 25 * 1024 * 1024,
      queue_position: 1,
      status: 'pending_manual_download'
    }));

    assert.ok(created.id > 0);
    assert.strictEqual(created.authorized_user_id, 42);
    assert.strictEqual(created.file_unique_id, 'unique-doc-1');
    assert.strictEqual(created.deduplication_key, 'unique-doc-1');
    assert.strictEqual(created.status, 'pending_manual_download');
  });
}

function testFindByFileUniqueIdReturnsExistingRecord() {
  withRepository((repository) => {
    repository.create(createRecord({
      file_id: 'video-1',
      file_unique_id: 'shared-unique-id',
      file_kind: 'video',
      queue_position: 2
    }));

    const found = repository.findByFileUniqueId('shared-unique-id');
    const missing = repository.findByFileUniqueId('missing-unique-id');

    assert.ok(found);
    assert.strictEqual(found.file_id, 'video-1');
    assert.strictEqual(found.file_kind, 'video');
    assert.strictEqual(missing, null);
  });
}

function testPendingManualDownloadQueuePrioritizesPhotoAndVideo() {
  withRepository((repository) => {
    repository.create(createRecord({
      file_id: 'doc-1',
      file_unique_id: 'doc-unique-1',
      file_kind: 'document',
      queue_position: 1
    }));
    repository.create(createRecord({
      file_id: 'photo-1',
      file_unique_id: 'photo-unique-1',
      file_kind: 'photo',
      queue_position: 2
    }));
    repository.create(createRecord({
      file_id: 'video-1',
      file_unique_id: 'video-unique-1',
      file_kind: 'video',
      queue_position: 3
    }));

    const queue = repository.getPendingManualDownloadQueue({
      limit: 10
    });

    assert.deepStrictEqual(
      queue.map((item) => item.file_kind),
      ['photo', 'video']
    );
    assert.deepStrictEqual(
      queue.map((item) => item.queue_position),
      [2, 3]
    );
  });
}

function testPendingManualDownloadQueueCanSortByLargestKnownSize() {
  withRepository((repository) => {
    repository.create(createRecord({
      file_id: 'small-1',
      file_unique_id: 'small-unique-1',
      file_kind: 'document',
      file_size: 5 * 1024 * 1024,
      queue_position: 1
    }));
    repository.create(createRecord({
      file_id: 'large-1',
      file_unique_id: 'large-unique-1',
      file_kind: 'photo',
      file_size: 50 * 1024 * 1024,
      queue_position: 2
    }));
    repository.create(createRecord({
      file_id: 'unknown-1',
      file_unique_id: 'unknown-unique-1',
      file_kind: 'video',
      file_size: null,
      queue_position: 3
    }));
    repository.create(createRecord({
      file_id: 'medium-1',
      file_unique_id: 'medium-unique-1',
      file_kind: 'video',
      file_size: 20 * 1024 * 1024,
      queue_position: 4
    }));

    const queue = repository.getPendingManualDownloadQueue({
      limit: 10,
      orderBy: 'size_desc'
    });

    assert.deepStrictEqual(
      queue.map((item) => item.file_unique_id),
      ['large-unique-1', 'medium-unique-1', 'small-unique-1']
    );
  });
}

function testPendingManualDownloadQueueCanSortBySmallestKnownSize() {
  withRepository((repository) => {
    repository.create(createRecord({
      file_id: 'large-1',
      file_unique_id: 'large-unique-1',
      file_kind: 'photo',
      file_size: 50 * 1024 * 1024,
      queue_position: 1
    }));
    repository.create(createRecord({
      file_id: 'unknown-1',
      file_unique_id: 'unknown-unique-1',
      file_kind: 'document',
      file_size: null,
      queue_position: 2
    }));
    repository.create(createRecord({
      file_id: 'small-1',
      file_unique_id: 'small-unique-1',
      file_kind: 'video',
      file_size: 5 * 1024 * 1024,
      queue_position: 3
    }));

    const queue = repository.getPendingManualDownloadQueue({
      limit: 10,
      orderBy: 'size_asc'
    });

    assert.deepStrictEqual(
      queue.map((item) => item.file_unique_id),
      ['small-unique-1', 'large-unique-1']
    );
  });
}

function testPendingManualDownloadQueueIsGlobalAcrossUsers() {
  withRepository((repository) => {
    repository.create(createRecord({
      authorized_user_id: 42,
      file_id: 'doc-1',
      file_unique_id: 'doc-unique-1',
      file_kind: 'document',
      queue_position: 1
    }));
    repository.create(createRecord({
      authorized_user_id: 77,
      file_id: 'photo-1',
      file_unique_id: 'photo-unique-1',
      file_kind: 'photo',
      queue_position: 2
    }));

    const queue = repository.getPendingManualDownloadQueue({
      limit: 10
    });

    assert.deepStrictEqual(
      queue.map((item) => item.authorized_user_id),
      [77]
    );

    assert.strictEqual(repository.getNextQueuePosition(), 3);
  });
}

function testPendingManualDownloadQueueFallsBackToDocuments() {
  withRepository((repository) => {
    repository.create(createRecord({
      file_id: 'doc-1',
      file_unique_id: 'doc-unique-1',
      file_kind: 'document',
      queue_position: 1
    }));
    repository.create(createRecord({
      file_id: 'photo-shown',
      file_unique_id: 'photo-shown-1',
      file_kind: 'photo',
      queue_position: 2,
      status: 'shown_to_user',
      shown_at: '2026-05-16T10:05:00.000Z'
    }));

    const queue = repository.getPendingManualDownloadQueue({
      limit: 10
    });

    assert.strictEqual(queue.length, 1);
    assert.strictEqual(queue[0].file_kind, 'document');
    assert.strictEqual(queue[0].file_unique_id, 'doc-unique-1');
  });
}

function testManualDownloadQueueIncludesActiveStatuses() {
  withRepository((repository) => {
    repository.create(createRecord({
      file_id: 'pending-1',
      file_unique_id: 'pending-unique-1',
      status: 'pending_manual_download',
      queue_position: 1
    }));
    repository.create(createRecord({
      file_id: 'unknown-1',
      file_unique_id: 'unknown-unique-1',
      status: 'pending_size_unknown',
      queue_position: 2
    }));
    repository.create(createRecord({
      file_id: 'shown-1',
      file_unique_id: 'shown-unique-1',
      status: 'shown_to_user',
      queue_position: 3
    }));
    repository.create(createRecord({
      file_id: 'confirmed-1',
      file_unique_id: 'confirmed-unique-1',
      status: 'download_confirmed',
      queue_position: 4
    }));

    const queue = repository.getManualDownloadQueue({
      limit: 100
    });

    assert.deepStrictEqual(
      queue.map((item) => item.status),
      ['pending_manual_download', 'pending_size_unknown', 'shown_to_user']
    );
  });
}

function testManualDownloadQueueSummaryIsNotLimited() {
  withRepository((repository) => {
    for (let index = 1; index <= 105; index += 1) {
      repository.create(createRecord({
        file_id: `pending-${index}`,
        file_unique_id: `pending-unique-${index}`,
        status: 'pending_manual_download',
        queue_position: index,
        file_size: 1024 * 1024
      }));
    }

    repository.create(createRecord({
      file_id: 'downloaded-1',
      file_unique_id: 'downloaded-unique-1',
      status: 'downloaded',
      queue_position: null,
      file_size: 1024 * 1024
    }));

    const summary = repository.getManualDownloadQueueSummary();

    assert.strictEqual(summary.fileCount, 105);
    assert.strictEqual(summary.totalKnownSize, 105 * 1024 * 1024);
    assert.strictEqual(summary.unknownSizeFiles, 0);
  });
}

function testPendingManualDownloadSummaryExcludesShownRecords() {
  withRepository((repository) => {
    repository.create(createRecord({
      file_id: 'pending-1',
      file_unique_id: 'pending-unique-1',
      status: 'pending_manual_download',
      queue_position: 1,
      file_size: 10 * 1024 * 1024
    }));
    repository.create(createRecord({
      file_id: 'shown-1',
      file_unique_id: 'shown-unique-1',
      status: 'shown_to_user',
      queue_position: 2,
      file_size: 20 * 1024 * 1024
    }));

    const summary = repository.getPendingManualDownloadSummary();

    assert.strictEqual(summary.fileCount, 1);
    assert.strictEqual(summary.totalKnownSize, 10 * 1024 * 1024);
  });
}

function testGetShownToUserFilesReturnsShownRecords() {
  withRepository((repository) => {
    repository.create(createRecord({
      file_id: 'pending-1',
      file_unique_id: 'pending-unique-1',
      status: 'pending_manual_download',
      queue_position: 1
    }));
    repository.create(createRecord({
      file_id: 'shown-1',
      file_unique_id: 'shown-unique-1',
      status: 'shown_to_user',
      shown_at: '2026-05-16T10:10:00.000Z',
      queue_position: 2
    }));

    const shown = repository.getShownToUserFiles();

    assert.strictEqual(shown.length, 1);
    assert.strictEqual(shown[0].file_unique_id, 'shown-unique-1');
  });
}

function testGetStatsAggregatesFiles() {
  withRepository((repository) => {
    repository.create(createRecord({
      file_id: 'doc-downloaded',
      file_unique_id: 'doc-downloaded-unique',
      file_kind: 'document',
      file_size: 10 * 1024 * 1024,
      status: 'downloaded',
      queue_position: null
    }));
    repository.create(createRecord({
      file_id: 'photo-pending',
      file_unique_id: 'photo-pending-unique',
      file_kind: 'photo',
      file_size: 25 * 1024 * 1024,
      status: 'pending_manual_download',
      queue_position: 1
    }));
    repository.create(createRecord({
      file_id: 'video-confirmed',
      file_unique_id: 'video-confirmed-unique',
      file_kind: 'video',
      file_size: null,
      status: 'download_confirmed',
      queue_position: 2
    }));
    repository.create(createRecord({
      file_id: 'doc-failed',
      file_unique_id: 'doc-failed-unique',
      file_kind: 'document',
      file_size: 3 * 1024 * 1024,
      status: 'send_failed',
      queue_position: 3
    }));

    const stats = repository.getStats();

    assert.strictEqual(stats.totalFiles, 4);
    assert.strictEqual(stats.totalKnownSize, 38 * 1024 * 1024);
    assert.strictEqual(Number.isInteger(stats.databaseSizeBytes), true);
    assert.strictEqual(stats.databaseSizeBytes > 0, true);
    assert.strictEqual(stats.unknownSizeFiles, 1);
    assert.strictEqual(stats.activeQueueFiles, 1);
    assert.strictEqual(stats.activeQueueKnownSize, 25 * 1024 * 1024);
    assert.strictEqual(stats.downloadedFiles, 1);
    assert.strictEqual(stats.downloadedKnownSize, 10 * 1024 * 1024);
    assert.strictEqual(stats.downloadConfirmedFiles, 1);
    assert.strictEqual(stats.failedFiles, 1);
    assert.strictEqual(stats.documentFiles, 2);
    assert.strictEqual(stats.photoFiles, 1);
    assert.strictEqual(stats.videoFiles, 1);
  });
}

function testGetStatsUsesMetaDuplicateCounterAndDeleteFailures() {
  withRepository((repository) => {
    repository.incrementMetaCounter('duplicate_skipped_count', 3, '2026-05-16T10:05:00.000Z');
    repository.create(createRecord({
      file_id: 'doc-downloaded-delete-failed',
      file_unique_id: 'doc-downloaded-delete-failed-unique',
      file_kind: 'document',
      file_size: 10 * 1024 * 1024,
      status: 'downloaded',
      error_code: 'delete_message_failed',
      error_message: 'cannot delete',
      queue_position: null
    }));

    const stats = repository.getStats();

    assert.strictEqual(stats.duplicateFiles, 3);
    assert.strictEqual(stats.failedFiles, 1);
  });
}

function testIncrementMetaCounterCreatesAndUpdatesCounter() {
  withRepository((repository) => {
    const first = repository.incrementMetaCounter('duplicate_skipped_count', 2, '2026-05-16T10:05:00.000Z');
    const second = repository.incrementMetaCounter('duplicate_skipped_count', 5, '2026-05-16T10:10:00.000Z');

    assert.strictEqual(first.key, 'duplicate_skipped_count');
    assert.strictEqual(first.value, '2');
    assert.strictEqual(second.value, '7');
    assert.strictEqual(repository.getStats().duplicateFiles, 7);
  });
}

function testGetNextQueuePositionUsesExistingMaximum() {
  withRepository((repository) => {
    assert.strictEqual(repository.getNextQueuePosition(), 1);

    repository.create(createRecord({
      file_id: 'doc-1',
      file_unique_id: 'doc-unique-1',
      file_kind: 'document',
      queue_position: 7
    }));
    repository.create(createRecord({
      file_id: 'downloaded-1',
      file_unique_id: 'downloaded-unique-1',
      file_kind: 'document',
      queue_position: null,
      status: 'downloaded'
    }));

    assert.strictEqual(repository.getNextQueuePosition(), 8);
  });
}

function testMarkFilesAsShownToUserUpdatesPendingRecords() {
  withRepository((repository) => {
    const first = repository.create(createRecord({
      file_id: 'photo-1',
      file_unique_id: 'photo-unique-1',
      file_kind: 'photo',
      queue_position: 1
    }));
    const second = repository.create(createRecord({
      file_id: 'video-1',
      file_unique_id: 'video-unique-1',
      file_kind: 'video',
      queue_position: 2
    }));

    const shownAt = '2026-05-16T10:10:00.000Z';
    const updated = repository.markFilesAsShownToUser([first.id, second.id], shownAt);

    assert.strictEqual(updated.length, 2);
    assert.deepStrictEqual(
      updated.map((item) => item.status),
      ['shown_to_user', 'shown_to_user']
    );
    assert.deepStrictEqual(
      updated.map((item) => item.shown_at),
      [shownAt, shownAt]
    );
  });
}

function testMarkFilesAsDownloadConfirmedUpdatesShownRecords() {
  withRepository((repository) => {
    const first = repository.create(createRecord({
      file_id: 'photo-1',
      file_unique_id: 'photo-unique-1',
      file_kind: 'photo',
      queue_position: 1,
      status: 'shown_to_user',
      shown_at: '2026-05-16T10:10:00.000Z'
    }));
    const second = repository.create(createRecord({
      file_id: 'video-1',
      file_unique_id: 'video-unique-1',
      file_kind: 'video',
      queue_position: 2,
      status: 'pending_manual_download'
    }));

    const confirmedAt = '2026-05-16T10:20:00.000Z';
    const updated = repository.markFilesAsDownloadConfirmed([first.id, second.id], confirmedAt);
    const foundFirst = repository.findByFileUniqueId('photo-unique-1');
    const foundSecond = repository.findByFileUniqueId('video-unique-1');

    assert.strictEqual(updated.length, 2);
    assert.deepStrictEqual(
      updated.map((item) => item.status),
      ['download_confirmed', 'download_confirmed']
    );
    assert.deepStrictEqual(
      updated.map((item) => item.download_confirmed_at),
      [confirmedAt, confirmedAt]
    );
    assert.strictEqual(foundFirst.status, 'download_confirmed');
    assert.strictEqual(foundSecond.status, 'download_confirmed');
  });
}

function testMarkFilesAsSendFailedStoresError() {
  withRepository((repository) => {
    const first = repository.create(createRecord({
      file_id: 'video-1',
      file_unique_id: 'video-unique-1',
      file_kind: 'video',
      queue_position: 1
    }));

    const updated = repository.markFilesAsSendFailed([first.id], new Error('cannot send'), '2026-05-16T10:30:00.000Z');
    const found = repository.findByFileUniqueId('video-unique-1');

    assert.strictEqual(updated.length, 1);
    assert.strictEqual(found.status, 'send_failed');
    assert.strictEqual(found.error_code, 'send_failed');
    assert.strictEqual(found.error_message, 'cannot send');
  });
}

function testMarkFilesDeleteMessageFailedKeepsStatus() {
  withRepository((repository) => {
    const first = repository.create(createRecord({
      file_id: 'doc-1',
      file_unique_id: 'doc-unique-1',
      file_kind: 'document',
      queue_position: null,
      status: 'downloaded'
    }));

    const updated = repository.markFilesDeleteMessageFailed([first.id], new Error('cannot delete'), '2026-05-16T10:35:00.000Z');
    const found = repository.findByFileUniqueId('doc-unique-1');

    assert.strictEqual(updated.length, 1);
    assert.strictEqual(found.status, 'downloaded');
    assert.strictEqual(found.error_code, 'delete_message_failed');
    assert.strictEqual(found.error_message, 'cannot delete');
  });
}

function testMarkActiveQueueAsDeletedByUserKeepsHistory() {
  withRepository((repository) => {
    repository.create(createRecord({
      file_id: 'pending-1',
      file_unique_id: 'pending-unique-1',
      status: 'pending_manual_download',
      queue_position: 1
    }));
    repository.create(createRecord({
      file_id: 'shown-1',
      file_unique_id: 'shown-unique-1',
      status: 'shown_to_user',
      queue_position: 2
    }));
    repository.create(createRecord({
      file_id: 'downloaded-1',
      file_unique_id: 'downloaded-unique-1',
      status: 'downloaded',
      queue_position: null
    }));

    const updated = repository.markActiveQueueAsDeletedByUser('2026-05-16T10:40:00.000Z');

    assert.strictEqual(updated.length, 2);
    assert.deepStrictEqual(
      updated.map((item) => item.status),
      ['deleted_by_user', 'deleted_by_user']
    );
    assert.strictEqual(repository.findByFileUniqueId('downloaded-unique-1').status, 'downloaded');
  });
}

function testCreateFileEventPersistsAuditRecord() {
  withRepository((repository) => {
    const first = repository.create(createRecord({
      file_id: 'doc-1',
      file_unique_id: 'doc-unique-1',
      file_kind: 'document',
      queue_position: null,
      status: 'downloaded'
    }));

    const event = repository.createFileEvent({
      file_record_id: first.id,
      file_unique_id: first.file_unique_id,
      file_kind: first.file_kind,
      status: 'downloaded',
      event_type: 'downloaded',
      created_at: '2026-05-16T10:45:00.000Z'
    });

    assert.ok(event.id > 0);
    assert.strictEqual(event.file_record_id, first.id);
    assert.strictEqual(event.file_unique_id, 'doc-unique-1');
    assert.strictEqual(event.file_kind, 'document');
    assert.strictEqual(event.status, 'downloaded');
    assert.strictEqual(event.event_type, 'downloaded');
  });
}

function withRepository(callback) {
  const databasePath = path.join(
    os.tmpdir(),
    `telegram-user-files-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`
  );

  try {
    const sqliteClient = createSqliteClient(databasePath);
    const repository = createTelegramUserFilesRepository(sqliteClient);

    repository.initializeSchema();
    callback(repository);
  } finally {
    if (fs.existsSync(databasePath)) {
      fs.unlinkSync(databasePath);
    }
  }
}

function createRecord(overrides) {
  const base = {
    authorized_user_id: 42,
    chat_id: 5001,
    message_id: 9001,
    media_group_id: null,
    file_id: 'file-1',
    file_unique_id: 'file-unique-1',
    file_name: 'file.bin',
    mime_type: 'application/octet-stream',
    file_size: 25 * 1024 * 1024,
    file_kind: 'document',
    deduplication_key: null,
    local_path: null,
    queue_position: 1,
    status: 'pending_manual_download',
    error_code: null,
    error_message: null,
    received_at: '2026-05-16T10:00:00.000Z',
    downloaded_at: null,
    shown_at: null,
    download_confirmed_at: null,
    created_at: '2026-05-16T10:00:00.000Z',
    updated_at: '2026-05-16T10:00:00.000Z'
  };
  const record = Object.assign({}, base, overrides || {});

  if (!record.deduplication_key) {
    record.deduplication_key = record.file_unique_id;
  }

  return record;
}

module.exports = {
  runTests
};
