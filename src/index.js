'use strict';

const fs = require('fs');
const path = require('path');

const { loadEnvFile } = require('./env');
const { createConfig } = require('./config');
const { createTelegramUpdateHandler } = require('./application/telegram-update-handler');
const { createTelegramPollingLoop } = require('./application/polling');
const { createSqliteClient } = require('./adapters/sqlite/sqlite-client');
const { createTelegramUserFilesRepository } = require('./adapters/sqlite/telegram-user-files-repository');
const { createTelegramClient } = require('./adapters/telegram/client');
const { createTelegramFileDownloader } = require('./adapters/telegram/file-downloader');
const { createStatsImageRenderer } = require('./application/stats-image-renderer');

async function main() {
  loadEnvFile();
  const config = createConfig(process.env);

  validateRuntimeConfig(config);
  ensureRuntimeDirectories(config);

  const sqliteClient = createSqliteClient(path.resolve(config.sqliteDbPath));
  const fileRepository = createTelegramUserFilesRepository(sqliteClient);
  fileRepository.initializeSchema();

  const telegramClient = createTelegramClient({
    token: config.telegramBotToken,
    minRequestIntervalMs: config.telegramApiMinRequestIntervalMs
  });
  const downloader = createTelegramFileDownloader({
    telegramClient,
    downloadsDir: config.downloadsDir
  });
  const statsImageRenderer = createStatsImageRenderer();
  const updateHandler = createTelegramUpdateHandler({
    authorizedUserIds: config.authorizedUserIds,
    smallFileLimitBytes: config.smallFileLimitBytes,
    fileRepository,
    downloader,
    messageDeleter: telegramClient,
    messageSender: telegramClient,
    fileSender: telegramClient,
    statsImageRenderer,
    callbackResponder: telegramClient,
    nextQueuePosition: () => fileRepository.getNextQueuePosition(),
    mediaGroupResponseDelayMs: config.mediaGroupResponseDelayMs
  });
  const pollingLoop = createTelegramPollingLoop({
    telegramClient,
    updateHandler,
    timeoutSeconds: config.telegramPollingTimeoutSeconds
  });

  console.log('Telegram file bot is starting.');
  console.log(
    JSON.stringify(
      {
        nodeEnv: config.nodeEnv,
        authorizedUserIds: config.authorizedUserIds,
        downloadsDir: config.downloadsDir,
        sqliteDbPath: config.sqliteDbPath,
        smallFileLimitBytes: config.smallFileLimitBytes,
        telegramPollingTimeoutSeconds: config.telegramPollingTimeoutSeconds,
        telegramApiMinRequestIntervalMs: config.telegramApiMinRequestIntervalMs,
        mediaGroupResponseDelayMs: config.mediaGroupResponseDelayMs
      },
      null,
      2
    )
  );

  await pollingLoop.start();
}

function validateRuntimeConfig(config) {
  if (!Array.isArray(config.authorizedUserIds) || config.authorizedUserIds.length === 0) {
    throw new Error('AUTHORIZED_USER_IDS is required');
  }

  if (!config.telegramBotToken || config.telegramBotToken === 'fake-token' || config.telegramBotToken.includes('replace-me')) {
    throw new Error('A real TELEGRAM_BOT_TOKEN is required');
  }
}

function ensureRuntimeDirectories(config) {
  fs.mkdirSync(path.resolve(config.downloadsDir), { recursive: true });
  fs.mkdirSync(path.dirname(path.resolve(config.sqliteDbPath)), { recursive: true });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  validateRuntimeConfig,
  ensureRuntimeDirectories
};
