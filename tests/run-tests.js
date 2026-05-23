'use strict';

const tests = [
  require('./bot-commands.test'),
  require('./env.test'),
  require('./polling.test'),
  require('./process-supervisor.test'),
  require('./process-message.test'),
  require('./stats-image.test'),
  require('./sqlite-repository.test'),
  require('./telegram-client.test'),
  require('./telegram-file-downloader.test'),
  require('./telegram-update-handler.test'),
  require('./user-messages.test')
];

run();

async function run() {
  let failed = false;

  for (const suite of tests) {
    try {
      await suite.runTests();
    } catch (error) {
      failed = true;
      console.error(error.stack || error.message || String(error));
    }
  }

  if (failed) {
    process.exitCode = 1;
    console.error('Tests failed.');
  } else {
    console.log('All tests passed.');
  }
}
