'use strict';

function createQueuedTelegramSender(options) {
  const sender = options && options.sender;
  const intervalMs = normalizeIntervalMs(options && options.intervalMs);
  const logger = options && options.logger ? options.logger : createSilentLogger();
  const setTimeoutFn = options && options.setTimeoutFn ? options.setTimeoutFn : setTimeout;
  const now = options && options.now ? options.now : () => Date.now();
  const queue = [];
  let running = false;
  let nextStartAt = 0;

  if (!sender) {
    throw new Error('sender is required');
  }

  return {
    sendMessage: (payload) => enqueue('sendMessage', payload),
    sendPhoto: (payload) => enqueue('sendPhoto', payload),
    sendVideo: (payload) => enqueue('sendVideo', payload),
    sendDocument: (payload) => enqueue('sendDocument', payload)
  };

  function enqueue(method, payload) {
    if (typeof sender[method] !== 'function') {
      return Promise.reject(new Error(`sender.${method} is required`));
    }

    return new Promise((resolve, reject) => {
      queue.push({ method, payload, resolve, reject });
      runQueue();
    });
  }

  async function runQueue() {
    if (running) {
      return;
    }

    running = true;

    while (queue.length > 0) {
      const item = queue.shift();
      const waitMs = Math.max(0, nextStartAt - now());

      if (waitMs > 0) {
        await delay(waitMs, setTimeoutFn);
      }

      nextStartAt = now() + intervalMs;

      try {
        item.resolve(await sender[item.method](item.payload));
      } catch (error) {
        logger.error('queued telegram send failed', {
          method: item.method,
          error
        });
        item.reject(error);
      }
    }

    running = false;
  }
}

function normalizeIntervalMs(value) {
  return Number.isFinite(value) && value >= 0 ? value : 500;
}

function delay(ms, setTimeoutFn) {
  return new Promise((resolve) => {
    setTimeoutFn(resolve, ms);
  });
}

function createSilentLogger() {
  return {
    error() {}
  };
}

module.exports = {
  createQueuedTelegramSender
};
