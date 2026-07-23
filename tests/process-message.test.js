'use strict';

const assert = require('assert');

const { processIncomingMessage } = require('../src/application/process-message');
const { extractSupportedAttachments } = require('../src/domain/attachments');
const { isDuplicateFile } = require('../src/domain/deduplication');
const { classifyFileSize, DEFAULT_SMALL_FILE_LIMIT_BYTES } = require('../src/domain/file-size');
const { createBaseMessage } = require('./helpers');

function runTests() {
  testUnauthorizedUsersAreRejected();
  testAuthorizedUserListIsAccepted();
  testMessageDateIsCopiedToAttachments();
  testCaptionAuthorIsCopiedToAttachments();
  testUnsupportedAttachmentsAreIgnored();
  testDeduplicationUsesFileUniqueId();
  testSmallAndLargeFileBoundaryUses20MbLimit();
}

function testMessageDateIsCopiedToAttachments() {
  const message = createBaseMessage({
    date: 1778880600,
    document: {
      file_id: 'doc-1',
      file_unique_id: 'uniq-doc-1',
      file_name: 'report.pdf',
      file_size: 1024
    }
  });

  const result = processIncomingMessage(message, {
    authorizedUserId: 42,
    knownDeduplicationKeys: new Set()
  });

  assert.strictEqual(result.attachments[0].message_date, 1778880600);
}

function testCaptionAuthorIsCopiedToAttachments() {
  const message = createBaseMessage({
    caption: '💎 Goblin Slayer (platinum)',
    video: {
      file_id: 'video-1',
      file_unique_id: 'uniq-video-1',
      file_size: 1024
    }
  });

  const result = processIncomingMessage(message, {
    authorizedUserId: 42,
    knownDeduplicationKeys: new Set()
  });

  assert.strictEqual(result.attachments[0].author, 'Goblin Slayer');
}

function testAuthorizedUserListIsAccepted() {
  const message = createBaseMessage({
    from: { id: 77 },
    document: {
      file_id: 'doc-1',
      file_unique_id: 'uniq-doc-1',
      file_name: 'report.pdf',
      file_size: 1024
    }
  });

  const result = processIncomingMessage(message, {
    authorizedUserIds: [42, 77],
    knownDeduplicationKeys: new Set()
  });

  assert.strictEqual(result.accepted, true);
  assert.strictEqual(result.attachments.length, 1);
}

function testUnauthorizedUsersAreRejected() {
  const message = createBaseMessage({
    from: { id: 999 },
    document: {
      file_id: 'doc-1',
      file_unique_id: 'uniq-doc-1',
      file_name: 'report.pdf',
      file_size: 1024
    }
  });

  const result = processIncomingMessage(message, {
    authorizedUserId: 42,
    knownDeduplicationKeys: new Set()
  });

  assert.strictEqual(result.accepted, false);
  assert.strictEqual(result.reason, 'unauthorized_user');
  assert.deepStrictEqual(result.attachments, []);
}

function testUnsupportedAttachmentsAreIgnored() {
  const message = createBaseMessage({
    sticker: {
      file_id: 'sticker-1',
      file_unique_id: 'sticker-unique-1'
    },
    voice: {
      file_id: 'voice-1',
      file_unique_id: 'voice-unique-1'
    }
  });

  const attachments = extractSupportedAttachments(message);
  const result = processIncomingMessage(message, {
    authorizedUserId: 42,
    knownDeduplicationKeys: new Set()
  });

  assert.deepStrictEqual(attachments, []);
  assert.strictEqual(result.accepted, true);
  assert.strictEqual(result.reason, 'no_supported_attachments');
  assert.deepStrictEqual(result.attachments, []);
}

function testDeduplicationUsesFileUniqueId() {
  const message = createBaseMessage({
    video: {
      file_id: 'video-2',
      file_unique_id: 'shared-unique-id',
      file_size: 2048
    }
  });

  const result = processIncomingMessage(message, {
    authorizedUserId: 42,
    knownDeduplicationKeys: new Set(['shared-unique-id'])
  });

  assert.strictEqual(result.attachments.length, 1);
  assert.strictEqual(result.attachments[0].deduplicationKey, 'shared-unique-id');
  assert.strictEqual(result.attachments[0].isDuplicate, true);
  assert.strictEqual(
    isDuplicateFile({ file_unique_id: 'shared-unique-id' }, new Set(['shared-unique-id'])),
    true
  );
}

function testSmallAndLargeFileBoundaryUses20MbLimit() {
  const exactly20Mb = DEFAULT_SMALL_FILE_LIMIT_BYTES;
  const largerThan20Mb = DEFAULT_SMALL_FILE_LIMIT_BYTES + 1;

  assert.strictEqual(classifyFileSize(exactly20Mb, DEFAULT_SMALL_FILE_LIMIT_BYTES), 'small');
  assert.strictEqual(classifyFileSize(largerThan20Mb, DEFAULT_SMALL_FILE_LIMIT_BYTES), 'large');
}

module.exports = {
  runTests
};
