'use strict';

const { toSqlValue } = require('./sqlite-client');

function createTelegramUserFilesRepository(sqliteClient) {
  if (!sqliteClient || typeof sqliteClient.query !== 'function' || typeof sqliteClient.execute !== 'function') {
    throw new Error('A sqlite client with execute/query methods is required');
  }

  return {
    initializeSchema,
    create,
    findByFileUniqueId,
    getPendingManualDownloadQueue,
    getManualDownloadQueue,
    getManualDownloadQueueSummary,
    getPendingManualDownloadSummary,
    getShownToUserFiles,
    getStats,
    getNextQueuePosition,
    createFileEvent,
    incrementMetaCounter,
    markFilesAsShownToUser,
    markFilesAsDownloadConfirmed,
    markFilesAsSendFailed,
    markFilesDeleteMessageFailed,
    markActiveQueueAsDeletedByUser
  };

  function initializeSchema() {
    sqliteClient.execute(`
      CREATE TABLE IF NOT EXISTS telegram_user_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        authorized_user_id INTEGER NOT NULL,
        chat_id INTEGER NOT NULL,
        message_id INTEGER NOT NULL,
        media_group_id TEXT,
        file_id TEXT NOT NULL,
        file_unique_id TEXT NOT NULL,
        file_name TEXT,
        mime_type TEXT,
        file_size INTEGER,
        file_kind TEXT NOT NULL,
        deduplication_key TEXT NOT NULL,
        local_path TEXT,
        queue_position INTEGER,
        status TEXT NOT NULL,
        error_code TEXT,
        error_message TEXT,
        received_at TEXT NOT NULL,
        downloaded_at TEXT,
        shown_at TEXT,
        download_confirmed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_telegram_user_files_file_unique_id
      ON telegram_user_files (file_unique_id);

      CREATE INDEX IF NOT EXISTS idx_telegram_user_files_pending_queue
      ON telegram_user_files (authorized_user_id, status, file_kind, queue_position, received_at);

      CREATE TABLE IF NOT EXISTS telegram_file_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_record_id INTEGER,
        file_unique_id TEXT,
        file_kind TEXT,
        status TEXT NOT NULL,
        event_type TEXT NOT NULL,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_telegram_file_events_record_id
      ON telegram_file_events (file_record_id);

      CREATE INDEX IF NOT EXISTS idx_telegram_file_events_file_unique_id
      ON telegram_file_events (file_unique_id);

      CREATE TABLE IF NOT EXISTS telegram_bot_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT OR IGNORE INTO telegram_bot_meta (key, value, created_at, updated_at)
      SELECT
        'duplicate_skipped_count',
        CAST(COUNT(*) AS TEXT),
        datetime('now'),
        datetime('now')
      FROM telegram_file_events
      WHERE event_type = 'duplicate_skipped';
    `);
  }

  function create(record) {
    const normalizedRecord = normalizeCreateRecord(record);
    const insertedRows = sqliteClient.query(`
      INSERT INTO telegram_user_files (
        authorized_user_id,
        chat_id,
        message_id,
        media_group_id,
        file_id,
        file_unique_id,
        file_name,
        mime_type,
        file_size,
        file_kind,
        deduplication_key,
        local_path,
        queue_position,
        status,
        error_code,
        error_message,
        received_at,
        downloaded_at,
        shown_at,
        download_confirmed_at,
        created_at,
        updated_at
      ) VALUES (
        ${toSqlValue(normalizedRecord.authorized_user_id)},
        ${toSqlValue(normalizedRecord.chat_id)},
        ${toSqlValue(normalizedRecord.message_id)},
        ${toSqlValue(normalizedRecord.media_group_id)},
        ${toSqlValue(normalizedRecord.file_id)},
        ${toSqlValue(normalizedRecord.file_unique_id)},
        ${toSqlValue(normalizedRecord.file_name)},
        ${toSqlValue(normalizedRecord.mime_type)},
        ${toSqlValue(normalizedRecord.file_size)},
        ${toSqlValue(normalizedRecord.file_kind)},
        ${toSqlValue(normalizedRecord.deduplication_key)},
        ${toSqlValue(normalizedRecord.local_path)},
        ${toSqlValue(normalizedRecord.queue_position)},
        ${toSqlValue(normalizedRecord.status)},
        ${toSqlValue(normalizedRecord.error_code)},
        ${toSqlValue(normalizedRecord.error_message)},
        ${toSqlValue(normalizedRecord.received_at)},
        ${toSqlValue(normalizedRecord.downloaded_at)},
        ${toSqlValue(normalizedRecord.shown_at)},
        ${toSqlValue(normalizedRecord.download_confirmed_at)},
        ${toSqlValue(normalizedRecord.created_at)},
        ${toSqlValue(normalizedRecord.updated_at)}
      )
      RETURNING *;
    `);

    return insertedRows[0] || null;
  }

  function findByFileUniqueId(fileUniqueId) {
    const rows = sqliteClient.query(`
      SELECT *
      FROM telegram_user_files
      WHERE file_unique_id = ${toSqlValue(fileUniqueId)}
      ORDER BY created_at ASC, id ASC
      LIMIT 1;
    `);

    return rows[0] || null;
  }

  function getPendingManualDownloadQueue(options) {
    const normalizedOptions = options || {};
    const limit = normalizePositiveInteger(normalizedOptions.limit, 10);

    const photoAndVideoRows = sqliteClient.query(`
      SELECT *
      FROM telegram_user_files
      WHERE status = 'pending_manual_download'
        AND file_kind IN ('photo', 'video')
      ORDER BY queue_position ASC, received_at ASC, id ASC
      LIMIT ${limit};
    `);

    if (photoAndVideoRows.length > 0) {
      return photoAndVideoRows;
    }

    return sqliteClient.query(`
      SELECT *
      FROM telegram_user_files
      WHERE status = 'pending_manual_download'
        AND file_kind = 'document'
      ORDER BY queue_position ASC, received_at ASC, id ASC
      LIMIT ${limit};
    `);
  }

  function getManualDownloadQueue(options) {
    const normalizedOptions = options || {};
    const limit = normalizePositiveInteger(normalizedOptions.limit, 100);

    return sqliteClient.query(`
      SELECT *
      FROM telegram_user_files
      WHERE status IN ('pending_manual_download', 'pending_size_unknown', 'shown_to_user')
      ORDER BY queue_position ASC, received_at ASC, id ASC
      LIMIT ${limit};
    `);
  }

  function getManualDownloadQueueSummary() {
    const rows = sqliteClient.query(`
      SELECT
        COUNT(*) AS file_count,
        COALESCE(SUM(CASE WHEN file_size IS NOT NULL THEN file_size ELSE 0 END), 0) AS total_known_size,
        SUM(CASE WHEN file_size IS NULL THEN 1 ELSE 0 END) AS unknown_size_files
      FROM telegram_user_files
      WHERE status IN ('pending_manual_download', 'pending_size_unknown', 'shown_to_user');
    `);

    return normalizeQueueSummaryRow(rows[0] || {});
  }

  function getPendingManualDownloadSummary() {
    const rows = sqliteClient.query(`
      SELECT
        COUNT(*) AS file_count,
        COALESCE(SUM(CASE WHEN file_size IS NOT NULL THEN file_size ELSE 0 END), 0) AS total_known_size,
        SUM(CASE WHEN file_size IS NULL THEN 1 ELSE 0 END) AS unknown_size_files
      FROM telegram_user_files
      WHERE status IN ('pending_manual_download', 'pending_size_unknown');
    `);

    return normalizeQueueSummaryRow(rows[0] || {});
  }

  function getShownToUserFiles() {
    return sqliteClient.query(`
      SELECT *
      FROM telegram_user_files
      WHERE status = 'shown_to_user'
      ORDER BY shown_at ASC, queue_position ASC, id ASC;
    `);
  }

  function getStats() {
    const totals = sqliteClient.query(`
      SELECT
        COUNT(*) AS total_files,
        COALESCE(SUM(CASE WHEN file_size IS NOT NULL THEN file_size ELSE 0 END), 0) AS total_known_size,
        SUM(CASE WHEN file_size IS NULL THEN 1 ELSE 0 END) AS unknown_size_files,
        SUM(CASE WHEN status IN ('pending_manual_download', 'pending_size_unknown', 'shown_to_user') THEN 1 ELSE 0 END) AS active_queue_files,
        COALESCE(SUM(CASE WHEN status IN ('pending_manual_download', 'pending_size_unknown', 'shown_to_user') AND file_size IS NOT NULL THEN file_size ELSE 0 END), 0) AS active_queue_known_size,
        SUM(CASE WHEN status = 'downloaded' THEN 1 ELSE 0 END) AS downloaded_files,
        SUM(CASE WHEN status = 'download_confirmed' THEN 1 ELSE 0 END) AS download_confirmed_files,
        COALESCE((
          SELECT CAST(value AS INTEGER)
          FROM telegram_bot_meta
          WHERE key = 'duplicate_skipped_count'
        ), 0) AS duplicate_files,
        SUM(CASE WHEN status IN ('download_failed', 'send_failed') OR error_code = 'delete_message_failed' THEN 1 ELSE 0 END) AS failed_files,
        SUM(CASE WHEN file_kind = 'document' THEN 1 ELSE 0 END) AS document_files,
        SUM(CASE WHEN file_kind = 'photo' THEN 1 ELSE 0 END) AS photo_files,
        SUM(CASE WHEN file_kind = 'video' THEN 1 ELSE 0 END) AS video_files
      FROM telegram_user_files;
    `);

    return normalizeStatsRow(totals[0] || {});
  }

  function getNextQueuePosition() {
    const rows = sqliteClient.query(`
      SELECT COALESCE(MAX(queue_position), 0) + 1 AS next_queue_position
      FROM telegram_user_files
      WHERE queue_position IS NOT NULL;
    `);

    return rows.length > 0 ? rows[0].next_queue_position : 1;
  }

  function createFileEvent(event) {
    const normalizedEvent = normalizeFileEvent(event);
    const insertedRows = sqliteClient.query(`
      INSERT INTO telegram_file_events (
        file_record_id,
        file_unique_id,
        file_kind,
        status,
        event_type,
        error_code,
        error_message,
        created_at
      ) VALUES (
        ${toSqlValue(normalizedEvent.file_record_id)},
        ${toSqlValue(normalizedEvent.file_unique_id)},
        ${toSqlValue(normalizedEvent.file_kind)},
        ${toSqlValue(normalizedEvent.status)},
        ${toSqlValue(normalizedEvent.event_type)},
        ${toSqlValue(normalizedEvent.error_code)},
        ${toSqlValue(normalizedEvent.error_message)},
        ${toSqlValue(normalizedEvent.created_at)}
      )
      RETURNING *;
    `);

    return insertedRows[0] || null;
  }

  function incrementMetaCounter(key, incrementBy, updatedAt) {
    const normalizedKey = requiredString(key, 'key');
    const increment = Number.isInteger(incrementBy) ? incrementBy : 1;
    const timestamp = updatedAt || new Date().toISOString();
    const rows = sqliteClient.query(`
      INSERT INTO telegram_bot_meta (key, value, created_at, updated_at)
      VALUES (${toSqlValue(normalizedKey)}, ${toSqlValue(String(increment))}, ${toSqlValue(timestamp)}, ${toSqlValue(timestamp)})
      ON CONFLICT(key) DO UPDATE SET
        value = CAST(CAST(value AS INTEGER) + ${toSqlValue(increment)} AS TEXT),
        updated_at = ${toSqlValue(timestamp)}
      RETURNING *;
    `);

    return rows[0] || null;
  }

  function markFilesAsShownToUser(recordIds, shownAt) {
    return updateStatuses({
      recordIds,
      currentStatus: 'pending_manual_download',
      nextStatus: 'shown_to_user',
      timestampColumn: 'shown_at',
      timestampValue: shownAt || new Date().toISOString()
    });
  }

  function markFilesAsDownloadConfirmed(recordIds, confirmedAt) {
    return updateStatuses({
      recordIds,
      currentStatus: 'shown_to_user',
      nextStatus: 'download_confirmed',
      timestampColumn: 'download_confirmed_at',
      timestampValue: confirmedAt || new Date().toISOString()
    });
  }

  function markFilesAsSendFailed(recordIds, error, failedAt) {
    const ids = Array.isArray(recordIds) ? recordIds.filter(isPositiveInteger) : [];

    if (ids.length === 0) {
      return [];
    }

    const timestamp = failedAt || new Date().toISOString();
    const idsSql = ids.map(toSqlValue).join(', ');
    const errorMessage = error && error.message ? error.message : String(error || 'send_failed');

    return sqliteClient.query(`
      UPDATE telegram_user_files
      SET status = 'send_failed',
          error_code = 'send_failed',
          error_message = ${toSqlValue(errorMessage)},
          updated_at = ${toSqlValue(timestamp)}
      WHERE id IN (${idsSql})
        AND status = 'pending_manual_download'
      RETURNING *;
    `);
  }

  function markFilesDeleteMessageFailed(recordIds, error, failedAt) {
    const ids = Array.isArray(recordIds) ? recordIds.filter(isPositiveInteger) : [];

    if (ids.length === 0) {
      return [];
    }

    const timestamp = failedAt || new Date().toISOString();
    const idsSql = ids.map(toSqlValue).join(', ');
    const errorMessage = error && error.message ? error.message : String(error || 'delete_message_failed');

    return sqliteClient.query(`
      UPDATE telegram_user_files
      SET error_code = 'delete_message_failed',
          error_message = ${toSqlValue(errorMessage)},
          updated_at = ${toSqlValue(timestamp)}
      WHERE id IN (${idsSql})
      RETURNING *;
    `);
  }

  function markActiveQueueAsDeletedByUser(deletedAt) {
    const timestamp = deletedAt || new Date().toISOString();

    return sqliteClient.query(`
      UPDATE telegram_user_files
      SET status = 'deleted_by_user',
          updated_at = ${toSqlValue(timestamp)}
      WHERE status IN ('pending_manual_download', 'pending_size_unknown', 'shown_to_user')
      RETURNING *;
    `);
  }

  function updateStatuses(options) {
    const recordIds = Array.isArray(options.recordIds) ? options.recordIds.filter(isPositiveInteger) : [];

    if (recordIds.length === 0) {
      return [];
    }

    const idsSql = recordIds.map(toSqlValue).join(', ');

    return sqliteClient.query(`
      UPDATE telegram_user_files
      SET status = ${toSqlValue(options.nextStatus)},
          ${options.timestampColumn} = ${toSqlValue(options.timestampValue)},
          updated_at = ${toSqlValue(options.timestampValue)}
      WHERE id IN (${idsSql})
        AND status = ${toSqlValue(options.currentStatus)}
      RETURNING *;
    `);
  }
}

function normalizeFileEvent(event) {
  if (!event || typeof event !== 'object') {
    throw new Error('event is required');
  }

  const fileRecordId = event.file_record_id === undefined ? event.fileRecordId : event.file_record_id;
  const fileUniqueId = event.file_unique_id === undefined ? event.fileUniqueId : event.file_unique_id;
  const fileKind = event.file_kind === undefined ? event.fileKind : event.file_kind;
  const eventType = event.event_type === undefined ? event.eventType : event.event_type;

  return {
    file_record_id: optionalNumber(fileRecordId),
    file_unique_id: optionalValue(fileUniqueId),
    file_kind: optionalValue(fileKind),
    status: requiredString(event.status, 'status'),
    event_type: requiredString(eventType, 'event_type'),
    error_code: optionalValue(event.error_code === undefined ? event.errorCode : event.error_code),
    error_message: optionalValue(event.error_message === undefined ? event.errorMessage : event.error_message),
    created_at: event.created_at || event.createdAt || new Date().toISOString()
  };
}

function normalizeCreateRecord(record) {
  if (!record || typeof record !== 'object') {
    throw new Error('record is required');
  }

  const now = record.created_at || new Date().toISOString();

  return {
    authorized_user_id: requiredNumber(record.authorized_user_id, 'authorized_user_id'),
    chat_id: requiredNumber(record.chat_id, 'chat_id'),
    message_id: requiredNumber(record.message_id, 'message_id'),
    media_group_id: optionalValue(record.media_group_id),
    file_id: requiredString(record.file_id, 'file_id'),
    file_unique_id: requiredString(record.file_unique_id, 'file_unique_id'),
    file_name: optionalValue(record.file_name),
    mime_type: optionalValue(record.mime_type),
    file_size: optionalNumber(record.file_size),
    file_kind: requiredString(record.file_kind, 'file_kind'),
    deduplication_key: requiredString(record.deduplication_key, 'deduplication_key'),
    local_path: optionalValue(record.local_path),
    queue_position: optionalNumber(record.queue_position),
    status: requiredString(record.status, 'status'),
    error_code: optionalValue(record.error_code),
    error_message: optionalValue(record.error_message),
    received_at: requiredString(record.received_at, 'received_at'),
    downloaded_at: optionalValue(record.downloaded_at),
    shown_at: optionalValue(record.shown_at),
    download_confirmed_at: optionalValue(record.download_confirmed_at),
    created_at: now,
    updated_at: record.updated_at || now
  };
}

function requiredString(value, fieldName) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${fieldName} is required`);
  }

  return value;
}

function requiredNumber(value, fieldName) {
  if (!Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a number`);
  }

  return value;
}

function optionalNumber(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Number.isFinite(value)) {
    throw new Error('Optional numeric field must be a finite number');
  }

  return value;
}

function optionalValue(value) {
  return value === undefined ? null : value;
}

function normalizePositiveInteger(value, fallback) {
  if (Number.isInteger(value) && value > 0) {
    return value;
  }

  return fallback;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function normalizeStatsRow(row) {
  return {
    totalFiles: normalizeStatNumber(row.total_files),
    totalKnownSize: normalizeStatNumber(row.total_known_size),
    unknownSizeFiles: normalizeStatNumber(row.unknown_size_files),
    activeQueueFiles: normalizeStatNumber(row.active_queue_files),
    activeQueueKnownSize: normalizeStatNumber(row.active_queue_known_size),
    downloadedFiles: normalizeStatNumber(row.downloaded_files),
    downloadConfirmedFiles: normalizeStatNumber(row.download_confirmed_files),
    duplicateFiles: normalizeStatNumber(row.duplicate_files),
    failedFiles: normalizeStatNumber(row.failed_files),
    documentFiles: normalizeStatNumber(row.document_files),
    photoFiles: normalizeStatNumber(row.photo_files),
    videoFiles: normalizeStatNumber(row.video_files)
  };
}

function normalizeQueueSummaryRow(row) {
  return {
    fileCount: normalizeStatNumber(row.file_count),
    totalKnownSize: normalizeStatNumber(row.total_known_size),
    unknownSizeFiles: normalizeStatNumber(row.unknown_size_files)
  };
}

function normalizeStatNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

module.exports = {
  createTelegramUserFilesRepository,
  normalizeCreateRecord,
  normalizeQueueSummaryRow,
  normalizeStatsRow
};
