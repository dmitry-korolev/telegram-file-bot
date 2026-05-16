'use strict';

const fs = require('fs');
const path = require('path');

function loadEnvFile(envPath) {
  const resolvedPath = envPath || path.resolve(process.cwd(), '.env');

  if (!fs.existsSync(resolvedPath)) {
    return {};
  }

  const parsed = parseEnv(fs.readFileSync(resolvedPath, 'utf8'));

  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return parsed;
}

function parseEnv(content) {
  const result = {};
  const lines = String(content || '').split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();

    if (!key) {
      continue;
    }

    result[key] = unquote(rawValue);
  }

  return result;
}

function unquote(value) {
  if (value.length < 2) {
    return value;
  }

  const first = value[0];
  const last = value[value.length - 1];

  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }

  return value;
}

module.exports = {
  loadEnvFile,
  parseEnv
};
