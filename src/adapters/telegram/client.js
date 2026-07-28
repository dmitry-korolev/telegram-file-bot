'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');

function createTelegramClient(options) {
  const token = options && options.token;
  const minRequestIntervalMs = options && Number.isFinite(options.minRequestIntervalMs)
    ? options.minRequestIntervalMs
    : 0;
  const requestFn = options && options.requestFn ? options.requestFn : https.request;
  const logger = options && options.logger ? options.logger : createSilentLogger();
  let nextRequestAt = 0;

  if (!token || token === 'fake-token' || token === 'replace-me-with-a-fake-token-for-local-dev') {
    throw new Error('A real TELEGRAM_BOT_TOKEN is required');
  }

  return {
    getUpdates,
    getFile,
    setMyCommands,
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

  async function setMyCommands(commands, options) {
    const params = {
      commands: Array.isArray(commands) ? commands : []
    };

    if (options && options.scope) {
      params.scope = options.scope;
    }

    return callApi('setMyCommands', params);
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
    if (payload.photoBuffer) {
      return callApiMultipart('sendPhoto', {
        chat_id: payload.chatId,
        caption: payload.caption || null,
        reply_markup: payload.replyMarkup ? JSON.stringify(payload.replyMarkup) : null
      }, {
        fieldName: 'photo',
        filename: payload.filename || 'photo.png',
        contentType: 'image/png',
        buffer: payload.photoBuffer
      });
    }

    return callApi('sendPhoto', withOptionalMediaOptions({
      chat_id: payload.chatId,
      photo: payload.fileId
    }, payload));
  }

  async function sendVideo(payload) {
    return callApi('sendVideo', withOptionalMediaOptions({
      chat_id: payload.chatId,
      video: payload.fileId
    }, payload));
  }

  async function sendDocument(payload) {
    return callApi('sendDocument', withOptionalMediaOptions({
      chat_id: payload.chatId,
      document: payload.fileId
    }, payload));
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
    const startedAt = Date.now();
    logger.log('telegram file download started', {
      filePath,
      destinationPath
    });

    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destinationPath);
      const request = https.get(createFileUrl(filePath), (response) => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          file.destroy();
          const error = new Error(`Telegram file download failed with HTTP ${response.statusCode}`);
          logger.error('telegram file download failed', {
            filePath,
            destinationPath,
            statusCode: response.statusCode,
            durationMs: Date.now() - startedAt,
            error
          });
          reject(error);
          return;
        }

        logger.log('telegram file download response received', {
          filePath,
          statusCode: response.statusCode,
          contentLength: response.headers && response.headers['content-length'] ? Number(response.headers['content-length']) : null
        });
        response.pipe(file);
      });

      request.on('error', (error) => {
        file.destroy();
        logger.error('telegram file download request failed', {
          filePath,
          destinationPath,
          durationMs: Date.now() - startedAt,
          error
        });
        reject(error);
      });

      file.on('finish', () => {
        file.close(() => {
          logger.log('telegram file download finished', {
            filePath,
            destinationPath,
            durationMs: Date.now() - startedAt
          });
          resolve(destinationPath);
        });
      });

      file.on('error', (error) => {
        logger.error('telegram file write failed', {
          filePath,
          destinationPath,
          durationMs: Date.now() - startedAt,
          error
        });
        reject(error);
      });
    });
  }

  async function callApi(method, params) {
    await waitForRequestSlot();
    const body = JSON.stringify(params || {});
    const startedAt = Date.now();
    logger.log('telegram api request started', buildApiLogFields(method, params));

    return new Promise((resolve, reject) => {
      const request = requestFn(createApiRequestOptions(method, body), (response) => {
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
            const error = new Error(`Telegram API ${method} failed: ${parsed.description || 'unknown error'}`);
            logger.error('telegram api request failed', Object.assign(
              buildApiLogFields(method, params),
              {
                durationMs: Date.now() - startedAt,
                statusCode: response.statusCode,
                error
              }
            ));
            reject(error);
            return;
          }

          logger.log('telegram api request finished', Object.assign(
            buildApiLogFields(method, params),
            {
              durationMs: Date.now() - startedAt,
              statusCode: response.statusCode
            }
          ));
          resolve(parsed.result);
        });
      });

      request.on('error', (error) => {
        logger.error('telegram api request error', Object.assign(
          buildApiLogFields(method, params),
          {
            durationMs: Date.now() - startedAt,
            error
          }
        ));
        reject(error);
      });
      request.write(body);
      request.end();
    });
  }

  async function callApiMultipart(method, params, file) {
    await waitForRequestSlot();
    const boundary = `telegram-file-bot-${Date.now().toString(16)}`;
    const body = buildMultipartBody(boundary, params, file);
    const startedAt = Date.now();
    logger.log('telegram multipart api request started', Object.assign(
      buildApiLogFields(method, params),
      buildFileLogFields(file)
    ));

    return new Promise((resolve, reject) => {
      const request = requestFn(createMultipartRequestOptions(method, body, boundary), (response) => {
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
            const error = new Error(`Telegram API ${method} failed: ${parsed.description || 'unknown error'}`);
            logger.error('telegram multipart api request failed', Object.assign(
              buildApiLogFields(method, params),
              buildFileLogFields(file),
              {
                durationMs: Date.now() - startedAt,
                statusCode: response.statusCode,
                error
              }
            ));
            reject(error);
            return;
          }

          logger.log('telegram multipart api request finished', Object.assign(
            buildApiLogFields(method, params),
            buildFileLogFields(file),
            {
              durationMs: Date.now() - startedAt,
              statusCode: response.statusCode
            }
          ));
          resolve(parsed.result);
        });
      });

      request.on('error', (error) => {
        logger.error('telegram multipart api request error', Object.assign(
          buildApiLogFields(method, params),
          buildFileLogFields(file),
          {
            durationMs: Date.now() - startedAt,
            error
          }
        ));
        reject(error);
      });
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

  function createMultipartRequestOptions(method, body, boundary) {
    return {
      hostname: 'api.telegram.org',
      path: `/bot${token}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    };
  }

  function createFileUrl(filePath) {
    return `https://api.telegram.org/file/bot${token}/${filePath}`;
  }
}

function buildApiLogFields(method, params) {
  const normalizedParams = params || {};

  return {
    method,
    chatId: normalizedParams.chat_id,
    messageId: normalizedParams.message_id,
    fileId: normalizedParams.file_id || normalizedParams.photo || normalizedParams.video || normalizedParams.document,
    callbackQueryId: normalizedParams.callback_query_id,
    timeout: normalizedParams.timeout,
    offset: normalizedParams.offset
  };
}

function buildFileLogFields(file) {
  return {
    uploadField: file && file.fieldName,
    filename: file && file.filename,
    contentType: file && file.contentType,
    bytes: file && file.buffer ? file.buffer.length : null
  };
}

function withOptionalCaption(params, caption) {
  if (typeof caption === 'string' && caption.length > 0) {
    params.caption = caption;
  }

  return params;
}

function withOptionalMediaOptions(params, payload) {
  const normalizedPayload = payload || {};

  withOptionalCaption(params, normalizedPayload.caption);

  if (normalizedPayload.replyMarkup) {
    params.reply_markup = normalizedPayload.replyMarkup;
  }

  return params;
}

function createSilentLogger() {
  return {
    log() {},
    error() {}
  };
}

function buildMultipartBody(boundary, params, file) {
  const parts = [];
  const normalizedParams = params || {};

  Object.keys(normalizedParams).forEach((key) => {
    const value = normalizedParams[key];

    if (value === undefined || value === null || value === '') {
      return;
    }

    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${escapeMultipartName(key)}"\r\n\r\n` +
      `${String(value)}\r\n`
    ));
  });

  parts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${escapeMultipartName(file.fieldName)}"; filename="${escapeMultipartName(file.filename)}"\r\n` +
    `Content-Type: ${file.contentType}\r\n\r\n`
  ));
  parts.push(Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer));
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  return Buffer.concat(parts);
}

function escapeMultipartName(value) {
  return String(value).replace(/"/g, '%22').replace(/\r/g, '').replace(/\n/g, '');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  createTelegramClient,
  buildMultipartBody,
  delay
};
