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
const { createQueuedTelegramSender } = require('./adapters/telegram/queued-sender');
const { createStatsImageRenderer } = require('./application/stats-image-renderer');
const { createLogger } = require('./application/logger');
const { BOT_COMMANDS, BOT_COMMAND_SCOPE_PRIVATE_CHATS } = require('./domain/bot-commands');

async function main() {
  const logger = createLogger({ component: 'bot' });
  loadEnvFile();
  const config = createConfig(process.env);

  logger.info('runtime config loaded', {
    nodeEnv: config.nodeEnv,
    authorizedUserIds: config.authorizedUserIds,
    downloadsDir: config.downloadsDir,
    sqliteDbPath: config.sqliteDbPath,
    smallFileLimitBytes: config.smallFileLimitBytes,
    telegramPollingTimeoutSeconds: config.telegramPollingTimeoutSeconds,
    telegramApiMinRequestIntervalMs: config.telegramApiMinRequestIntervalMs,
    telegramOutgoingMessageIntervalMs: config.telegramOutgoingMessageIntervalMs,
    downloadMaxAttempts: config.downloadMaxAttempts,
    downloadRetryDelayMs: config.downloadRetryDelayMs
  });

  validateRuntimeConfig(config);
  ensureRuntimeDirectories(config, logger);

  const sqliteClient = createSqliteClient(path.resolve(config.sqliteDbPath));
  const fileRepository = createTelegramUserFilesRepository(sqliteClient);
  logger.info('initializing sqlite schema', { sqliteDbPath: path.resolve(config.sqliteDbPath) });
  fileRepository.initializeSchema();

  const telegramClient = createTelegramClient({
    token: config.telegramBotToken,
    minRequestIntervalMs: config.telegramApiMinRequestIntervalMs,
    logger
  });
  await registerBotCommands(telegramClient, logger);
  const queuedTelegramSender = createQueuedTelegramSender({
    sender: telegramClient,
    intervalMs: config.telegramOutgoingMessageIntervalMs,
    logger
  });
  const downloader = createTelegramFileDownloader({
    telegramClient,
    downloadsDir: config.downloadsDir,
    logger
  });
  const statsImageRenderer = createStatsImageRenderer();
  const updateHandler = createTelegramUpdateHandler({
    authorizedUserIds: config.authorizedUserIds,
    smallFileLimitBytes: config.smallFileLimitBytes,
    fileRepository,
    downloader,
    messageDeleter: telegramClient,
    messageSender: queuedTelegramSender,
    fileSender: queuedTelegramSender,
    statsImageRenderer,
    callbackResponder: telegramClient,
    nextQueuePosition: () => fileRepository.getNextQueuePosition(),
    downloadMaxAttempts: config.downloadMaxAttempts,
    downloadRetryDelayMs: config.downloadRetryDelayMs,
    logger
  });
  const pollingLoop = createTelegramPollingLoop({
    telegramClient,
    updateHandler,
    timeoutSeconds: config.telegramPollingTimeoutSeconds,
    logger
  });

  logger.info('telegram file bot is starting');

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

function ensureRuntimeDirectories(config, logger) {
  const downloadsDir = path.resolve(config.downloadsDir);
  const sqliteDir = path.dirname(path.resolve(config.sqliteDbPath));

  fs.mkdirSync(downloadsDir, { recursive: true });
  fs.mkdirSync(sqliteDir, { recursive: true });
  warnIfDirectoryNotWritable(downloadsDir, 'DOWNLOADS_DIR', logger);
  warnIfDirectoryNotWritable(sqliteDir, 'SQLITE_DB_PATH directory', logger);
}

async function registerBotCommands(telegramClient, logger) {
  try {
    await telegramClient.setMyCommands(BOT_COMMANDS, {
      scope: BOT_COMMAND_SCOPE_PRIVATE_CHATS
    });
  } catch (error) {
    const normalizedLogger = logger || console;
    if (typeof normalizedLogger.error === 'function') {
      normalizedLogger.error('bot command registration failed', { error });
    }
  }
}

function warnIfDirectoryNotWritable(directoryPath, label, logger) {
  try {
    fs.accessSync(directoryPath, fs.constants.W_OK);
  } catch (error) {
    const normalizedLogger = logger || console;
    normalizedLogger.warn(`${label} is not writable`, { path: directoryPath, error });
  }
}

if (require.main === module) {
  main().catch((error) => {
    createLogger({ component: 'bot' }).error('fatal startup error', { error });
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  validateRuntimeConfig,
  ensureRuntimeDirectories,
  registerBotCommands,
  warnIfDirectoryNotWritable
};
