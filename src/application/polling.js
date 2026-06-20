'use strict';

function createTelegramPollingLoop(options) {
  const telegramClient = options && options.telegramClient;
  const updateHandler = options && options.updateHandler;
  const timeoutSeconds = (options && options.timeoutSeconds) || 25;
  const retryDelayMs = (options && options.retryDelayMs) || 1000;
  const logger = (options && options.logger) || console;

  if (!telegramClient || typeof telegramClient.getUpdates !== 'function') {
    throw new Error('telegramClient.getUpdates is required');
  }

  if (!updateHandler || typeof updateHandler.handleUpdate !== 'function') {
    throw new Error('updateHandler.handleUpdate is required');
  }

  let offset = 0;
  let stopped = false;

  return {
    start,
    stop
  };

  async function start() {
    logger.log('telegram polling started', { timeoutSeconds });

    while (!stopped) {
      try {
        logger.log('requesting telegram updates', { offset, timeoutSeconds });
        const updates = await telegramClient.getUpdates({
          offset,
          timeout: timeoutSeconds,
          allowed_updates: ['message', 'callback_query']
        });
        logger.log('telegram updates received', { offset, updateCount: updates.length });

        for (const update of updates) {
          try {
            logger.log('processing update', {
              updateId: update.update_id,
              updateType: update.callback_query ? 'callback_query' : update.message ? 'message' : 'unknown'
            });
            const result = await updateHandler.handleUpdate(update);
            logResult(update, result);
            offset = update.update_id + 1;
          } catch (error) {
            logger.error('update failed', { updateId: update.update_id, error });
            break;
          }
        }
      } catch (error) {
        logger.error('telegram polling request failed', { offset, error });
        await delay(retryDelayMs);
      }
    }
  }

  function stop() {
    stopped = true;
  }

  function logResult(update, result) {
    logger.log('update processed', {
      updateId: update.update_id,
      accepted: result.accepted,
      reason: result.reason,
      files: result.files.map((file) => ({
        fileKind: file.fileKind,
        status: file.status
      })),
      deleteMessageCalled: result.deleteMessageCalled,
      sendMessageCalled: result.sendMessageCalled
    });
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  createTelegramPollingLoop,
  delay
};
