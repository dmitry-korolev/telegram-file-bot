'use strict';

const path = require('path');

const { createRestartingProcessSupervisor } = require('./application/process-supervisor');
const { createLogger } = require('./application/logger');
const { normalizeOptionalNumber } = require('./config');

const restartDelayMs = normalizeOptionalNumber(process.env.BOT_RESTART_DELAY_MS) || 5000;
const logger = createLogger({ component: 'supervisor' });
const supervisor = createRestartingProcessSupervisor({
  command: process.execPath,
  args: [path.join(__dirname, 'index.js')],
  restartDelayMs,
  logger
});

supervisor.start();

process.once('SIGINT', stop);
process.once('SIGTERM', stop);

function stop(signal) {
  logger.info('received stop signal', { signal });
  supervisor.stop(signal);
}
