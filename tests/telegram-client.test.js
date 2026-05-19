'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');

const { buildMultipartBody, createTelegramClient } = require('../src/adapters/telegram/client');

async function runTests() {
  testBuildMultipartBodyIncludesFieldsAndFile();
  await testSendPhotoUploadsBufferWithMultipart();
}

function testBuildMultipartBodyIncludesFieldsAndFile() {
  const body = buildMultipartBody('boundary-1', {
    chat_id: 5001,
    caption: 'Статистика бота'
  }, {
    fieldName: 'photo',
    filename: 'stats.png',
    contentType: 'image/png',
    buffer: Buffer.from('png-data')
  }).toString('utf8');

  assert.strictEqual(body.includes('name="chat_id"'), true);
  assert.strictEqual(body.includes('5001'), true);
  assert.strictEqual(body.includes('name="caption"'), true);
  assert.strictEqual(body.includes('filename="stats.png"'), true);
  assert.strictEqual(body.includes('Content-Type: image/png'), true);
  assert.strictEqual(body.includes('png-data'), true);
}

async function testSendPhotoUploadsBufferWithMultipart() {
  const requests = [];
  const client = createTelegramClient({
    token: 'test-token',
    requestFn: (options, callback) => {
      const request = new EventEmitter();
      request.body = Buffer.alloc(0);
      request.write = (chunk) => {
        request.body = Buffer.concat([request.body, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      };
      request.end = () => {
        requests.push({ options, body: request.body });

        const response = new EventEmitter();
        response.setEncoding = () => {};
        callback(response);

        process.nextTick(() => {
          response.emit('data', JSON.stringify({ ok: true, result: { message_id: 123 } }));
          response.emit('end');
        });
      };

      return request;
    }
  });

  const result = await client.sendPhoto({
    chatId: 5001,
    photoBuffer: Buffer.from('png-data'),
    filename: 'stats.png',
    caption: 'Статистика бота'
  });

  assert.strictEqual(result.message_id, 123);
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].options.path, '/bottest-token/sendPhoto');
  assert.strictEqual(requests[0].options.headers['Content-Type'].startsWith('multipart/form-data; boundary='), true);
  assert.strictEqual(requests[0].body.includes(Buffer.from('name="photo"')), true);
  assert.strictEqual(requests[0].body.includes(Buffer.from('png-data')), true);
}

module.exports = {
  runTests
};
