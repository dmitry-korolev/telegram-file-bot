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
  testPendingManualDownloadQueueIsGlobalAcrossUsers();
  testPendingManualDownloadQueueFallsBackToDocuments();
  testManualDownloadQueueIncludesActiveStatuses();
  testGetShownToUserFilesReturnsShownRecords();
  testGetNextQueuePositionUsesExistingMaximum();
  testMarkFilesAsShownToUserUpdatesPendingRecords();
  testMarkFilesAsDownloadConfirmedUpdatesShownRecords();
  testMarkFilesAsSendFailedStoresError();
  testMarkActiveQueueAsDeletedByUserKeepsHistory();
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

    const confirmedAt = '2026-05-16T10:20:00.000Z';
    const updated = repository.markFilesAsDownloadConfirmed([first.id], confirmedAt);
    const found = repository.findByFileUniqueId('photo-unique-1');

    assert.strictEqual(updated.length, 1);
    assert.strictEqual(updated[0].status, 'download_confirmed');
    assert.strictEqual(updated[0].download_confirmed_at, confirmedAt);
    assert.strictEqual(found.status, 'download_confirmed');
    assert.strictEqual(found.download_confirmed_at, confirmedAt);
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
