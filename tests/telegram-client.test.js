'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');

const { buildMultipartBody, createTelegramClient } = require('../src/adapters/telegram/client');

async function runTests() {
  testBuildMultipartBodyIncludesFieldsAndFile();
  await testSetMyCommandsUsesTelegramMethod();
  await testSendPhotoUploadsBufferWithMultipart();
  await testFileIdSendsIncludeOptionalCaption();
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

async function testSetMyCommandsUsesTelegramMethod() {
  const requests = [];
  const client = createTelegramClient({
    token: 'test-token',
    requestFn: createMockRequestFn(requests, { ok: true, result: true })
  });

  const result = await client.setMyCommands([
    {
      command: 'show_queue',
      description: 'Показать очередь'
    }
  ], {
    scope: {
      type: 'all_private_chats'
    }
  });

  assert.strictEqual(result, true);
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].options.path, '/bottest-token/setMyCommands');
  assert.deepStrictEqual(JSON.parse(requests[0].body.toString('utf8')), {
    commands: [
      {
        command: 'show_queue',
        description: 'Показать очередь'
      }
    ],
    scope: {
      type: 'all_private_chats'
    }
  });
}

async function testFileIdSendsIncludeOptionalCaption() {
  const requests = [];
  const replyMarkup = {
    inline_keyboard: [
      [
        {
          text: 'Вернуть в очередь',
          callback_data: 'return_file_to_queue'
        }
      ]
    ]
  };
  const client = createTelegramClient({
    token: 'test-token',
    requestFn: createMockRequestFn(requests, { ok: true, result: { message_id: 321 } })
  });

  await client.sendPhoto({ chatId: 5001, fileId: 'photo-1', caption: 'Dr Strange', replyMarkup });
  await client.sendVideo({ chatId: 5001, fileId: 'video-1', caption: 'Goblin Slayer', replyMarkup });
  await client.sendDocument({ chatId: 5001, fileId: 'document-1', caption: 'Boolean Availability', replyMarkup });
  await client.sendDocument({ chatId: 5001, fileId: 'document-2' });

  assert.deepStrictEqual(
    requests.map((request) => ({
      path: request.options.path,
      body: JSON.parse(request.body.toString('utf8'))
    })),
    [
      {
        path: '/bottest-token/sendPhoto',
        body: { chat_id: 5001, photo: 'photo-1', caption: 'Dr Strange', reply_markup: replyMarkup }
      },
      {
        path: '/bottest-token/sendVideo',
        body: { chat_id: 5001, video: 'video-1', caption: 'Goblin Slayer', reply_markup: replyMarkup }
      },
      {
        path: '/bottest-token/sendDocument',
        body: { chat_id: 5001, document: 'document-1', caption: 'Boolean Availability', reply_markup: replyMarkup }
      },
      {
        path: '/bottest-token/sendDocument',
        body: { chat_id: 5001, document: 'document-2' }
      }
    ]
  );
}

function createMockRequestFn(requests, apiResponse) {
  return (options, callback) => {
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
        response.emit('data', JSON.stringify(apiResponse));
        response.emit('end');
      });
    };

    return request;
  };
}

module.exports = {
  runTests
};
