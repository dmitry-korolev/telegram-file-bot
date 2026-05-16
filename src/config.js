'use strict';

const { DEFAULT_SMALL_FILE_LIMIT_BYTES } = require('./domain/file-size');

function createConfig(env) {
  return {
    nodeEnv: env.NODE_ENV || 'development',
    telegramBotToken: env.TELEGRAM_BOT_TOKEN || 'fake-token',
    authorizedUserIds: normalizeNumberList(env.AUTHORIZED_USER_IDS || env.AUTHORIZED_USER_ID),
    smallFileLimitBytes: normalizeOptionalNumber(env.SMALL_FILE_LIMIT_BYTES) || DEFAULT_SMALL_FILE_LIMIT_BYTES,
    downloadsDir: env.DOWNLOADS_DIR || './storage/downloads',
    sqliteDbPath: env.SQLITE_DB_PATH || './storage/bot.sqlite',
    telegramPollingTimeoutSeconds: normalizeOptionalNumber(env.TELEGRAM_POLLING_TIMEOUT_SECONDS) || 25,
    telegramApiMinRequestIntervalMs: normalizeOptionalNumber(env.TELEGRAM_API_MIN_REQUEST_INTERVAL_MS) || 100,
    mediaGroupResponseDelayMs: normalizeOptionalNumber(env.MEDIA_GROUP_RESPONSE_DELAY_MS) || 2000
  };
}

function normalizeOptionalNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeNumberList(value) {
  if (value === undefined || value === null || value === '') {
    return [];
  }

  return String(value)
    .split(',')
    .map((item) => normalizeOptionalNumber(item.trim()))
    .filter((item) => item !== null);
}

module.exports = {
  createConfig,
  normalizeOptionalNumber,
  normalizeNumberList
};
