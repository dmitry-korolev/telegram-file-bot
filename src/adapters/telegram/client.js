'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');

function createTelegramClient(options) {
  const token = options && options.token;
  const minRequestIntervalMs = options && Number.isFinite(options.minRequestIntervalMs)
    ? options.minRequestIntervalMs
    : 0;
  let nextRequestAt = 0;

  if (!token || token === 'fake-token' || token === 'replace-me-with-a-fake-token-for-local-dev') {
    throw new Error('A real TELEGRAM_BOT_TOKEN is required');
  }

  return {
    getUpdates,
    getFile,
    sendMessage,
    sendPhoto,
    sendVideo,
    sendDocument,
    answerCallbackQuery,
    deleteMessage,
    downloadFile
  };

  async function getUpdates(params) {
    return callApi('getUpdates', params || {});
  }

  async function getFile(fileId) {
    return callApi('getFile', { file_id: fileId });
  }

  async function sendMessage(payload) {
    const params = {
      chat_id: payload.chatId,
      text: payload.text
    };

    if (payload.replyMarkup) {
      params.reply_markup = payload.replyMarkup;
    }

    return callApi('sendMessage', params);
  }

  async function sendPhoto(payload) {
    return callApi('sendPhoto', {
      chat_id: payload.chatId,
      photo: payload.fileId
    });
  }

  async function sendVideo(payload) {
    return callApi('sendVideo', {
      chat_id: payload.chatId,
      video: payload.fileId
    });
  }

  async function sendDocument(payload) {
    return callApi('sendDocument', {
      chat_id: payload.chatId,
      document: payload.fileId
    });
  }

  async function answerCallbackQuery(payload) {
    return callApi('answerCallbackQuery', {
      callback_query_id: payload.callbackQueryId
    });
  }

  async function deleteMessage(payload) {
    return callApi('deleteMessage', {
      chat_id: payload.chatId,
      message_id: payload.messageId
    });
  }

  async function downloadFile(filePath, destinationPath) {
    await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });

    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destinationPath);
      const request = https.get(createFileUrl(filePath), (response) => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          file.destroy();
          reject(new Error(`Telegram file download failed with HTTP ${response.statusCode}`));
          return;
        }

        response.pipe(file);
      });

      request.on('error', (error) => {
        file.destroy();
        reject(error);
      });

      file.on('finish', () => {
        file.close(() => resolve(destinationPath));
      });

      file.on('error', reject);
    });
  }

  async function callApi(method, params) {
    await waitForRequestSlot();
    const body = JSON.stringify(params || {});

    return new Promise((resolve, reject) => {
      const request = https.request(createApiRequestOptions(method, body), (response) => {
        let responseBody = '';

        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          responseBody += chunk;
        });
        response.on('end', () => {
          let parsed;

          try {
            parsed = JSON.parse(responseBody);
          } catch (error) {
            reject(new Error(`Telegram API returned invalid JSON for ${method}`));
            return;
          }

          if (!parsed.ok) {
            reject(new Error(`Telegram API ${method} failed: ${parsed.description || 'unknown error'}`));
            return;
          }

          resolve(parsed.result);
        });
      });

      request.on('error', reject);
      request.write(body);
      request.end();
    });
  }

  async function waitForRequestSlot() {
    if (minRequestIntervalMs <= 0) {
      return;
    }

    const now = Date.now();
    const waitMs = Math.max(0, nextRequestAt - now);
    nextRequestAt = Math.max(now, nextRequestAt) + minRequestIntervalMs;

    if (waitMs > 0) {
      await delay(waitMs);
    }
  }

  function createApiRequestOptions(method, body) {
    return {
      hostname: 'api.telegram.org',
      path: `/bot${token}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
  }

  function createFileUrl(filePath) {
    return `https://api.telegram.org/file/bot${token}/${filePath}`;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  createTelegramClient,
  delay
};
