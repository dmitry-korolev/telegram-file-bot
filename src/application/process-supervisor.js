'use strict';

const { spawn } = require('child_process');

function createRestartingProcessSupervisor(options) {
  const command = options && options.command;
  const args = (options && options.args) || [];
  const restartDelayMs = (options && options.restartDelayMs) || 5000;
  const spawnProcess = (options && options.spawnProcess) || spawn;
  const setRestartTimer = (options && options.setRestartTimer) || setTimeout;
  const clearRestartTimer = (options && options.clearRestartTimer) || clearTimeout;
  const logger = (options && options.logger) || console;

  if (!command) {
    throw new Error('command is required');
  }

  let child = null;
  let restartTimer = null;
  let stopping = false;

  return {
    start,
    stop
  };

  function start() {
    if (child || restartTimer) {
      throw new Error('process supervisor is already started');
    }

    stopping = false;
    startChild();
  }

  function stop(signal) {
    stopping = true;

    if (restartTimer) {
      clearRestartTimer(restartTimer);
      restartTimer = null;
    }

    if (child && typeof child.kill === 'function') {
      child.kill(signal || 'SIGTERM');
    }
  }

  function startChild() {
    logger.log(`Starting bot process: ${[command].concat(args).join(' ')}`);
    child = spawnProcess(command, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    pipeChildOutput(child, logger);

    let handledExit = false;

    child.on('error', (error) => {
      handleExit(`spawn error: ${error.message}`, handledExit);
      handledExit = true;
    });

    child.on('exit', (code, signal) => {
      handleExit(formatExitReason(code, signal), handledExit);
      handledExit = true;
    });
  }

  function handleExit(reason, alreadyHandled) {
    if (alreadyHandled) {
      return;
    }

    child = null;

    if (stopping) {
      logger.log(`Bot process stopped (${reason}).`);
      return;
    }

    logger.error(`Bot process exited (${reason}). Restarting in ${restartDelayMs} ms.`);
    restartTimer = setRestartTimer(() => {
      restartTimer = null;
      startChild();
    }, restartDelayMs);
  }
}

function pipeChildOutput(child, logger) {
  if (child.stdout && typeof child.stdout.on === 'function') {
    child.stdout.on('data', (chunk) => {
      writeLines(chunk, (line) => logger.log(`[bot] ${line}`));
    });
  }

  if (child.stderr && typeof child.stderr.on === 'function') {
    child.stderr.on('data', (chunk) => {
      writeLines(chunk, (line) => logger.error(`[bot] ${line}`));
    });
  }
}

function writeLines(chunk, writeLine) {
  String(chunk)
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .forEach(writeLine);
}

function formatExitReason(code, signal) {
  if (signal) {
    return `signal ${signal}`;
  }

  return `code ${code}`;
}

module.exports = {
  createRestartingProcessSupervisor,
  formatExitReason,
  pipeChildOutput
};
