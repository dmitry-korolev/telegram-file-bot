'use strict';

function createLogger(options) {
  const component = options && options.component ? options.component : 'app';
  const sink = options && options.sink ? options.sink : console;
  const now = options && options.now ? options.now : () => new Date();

  return {
    log,
    info,
    warn,
    error
  };

  function log(message, fields) {
    info(message, fields);
  }

  function info(message, fields) {
    write('info', message, fields, sink.log || console.log);
  }

  function warn(message, fields) {
    write('warn', message, fields, sink.warn || sink.error || console.warn);
  }

  function error(message, fields) {
    write('error', message, fields, sink.error || console.error);
  }

  function write(level, message, fields, writer) {
    const text = [
      now().toISOString(),
      level,
      component,
      normalizeMessage(message),
      formatFields(fields)
    ].filter(Boolean).join(' ');

    writer.call(sink, text);
  }
}

function normalizeMessage(message) {
  if (message instanceof Error) {
    return message.message;
  }

  return String(message === undefined || message === null ? '' : message);
}

function formatFields(fields) {
  if (!fields) {
    return '';
  }

  return JSON.stringify(normalizeFields(fields));
}

function normalizeFields(value) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      code: value.code,
      stack: value.stack
    };
  }

  if (Array.isArray(value)) {
    return value.map(normalizeFields);
  }

  if (value && typeof value === 'object') {
    return Object.keys(value).reduce((result, key) => {
      result[key] = normalizeFields(value[key]);
      return result;
    }, {});
  }

  return value;
}

module.exports = {
  createLogger,
  normalizeFields
};
