'use strict';

const { execFileSync } = require('child_process');

function createSqliteClient(databasePath) {
  if (!databasePath) {
    throw new Error('databasePath is required');
  }

  return {
    databasePath,
    execute,
    query
  };

  function execute(sql) {
    runSql(sql);
  }

  function query(sql) {
    const output = runSql(sql, ['-json']);

    if (!output.trim()) {
      return [];
    }

    return JSON.parse(output);
  }

  function runSql(sql, additionalArgs) {
    const args = []
      .concat(additionalArgs || [])
      .concat([databasePath, sql]);

    return execFileSync('sqlite3', args, {
      encoding: 'utf8'
    });
  }
}

function toSqlValue(value) {
  if (value === undefined || value === null) {
    return 'NULL';
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Cannot serialize non-finite number to SQL');
    }

    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }

  return `'${String(value).replace(/'/g, "''")}'`;
}

module.exports = {
  createSqliteClient,
  toSqlValue
};
