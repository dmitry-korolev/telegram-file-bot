'use strict';

const fs = require('fs');
const path = require('path');

const { createConfig } = require('../src/config');
const { loadEnvFile } = require('../src/env');
const { createSqliteClient, toSqlValue } = require('../src/adapters/sqlite/sqlite-client');
const { chooseLocalFileName, sanitizeFileName } = require('../src/adapters/telegram/file-downloader');

function main(argv) {
  const options = parseArgs(argv);
  loadEnvFile();

  const config = createConfig(process.env);
  const sqliteClient = createSqliteClient(path.resolve(options.sqliteDbPath || config.sqliteDbPath));
  const downloadsDir = path.resolve(options.downloadsDir || config.downloadsDir);
  const rows = readDownloadedFileRows(sqliteClient, options.batchSize);
  const plan = buildRenamePlan(rows, downloadsDir);

  printPlan(plan, options.apply);

  if (!options.apply) {
    console.log('Dry run only. Re-run with --apply to rename files and update local_path.');
    return;
  }

  applyRenamePlan(sqliteClient, plan);
}

function parseArgs(argv) {
  return argv.reduce((options, arg) => {
    if (arg === '--apply') {
      options.apply = true;
      return options;
    }

    if (arg.startsWith('--db=')) {
      options.sqliteDbPath = arg.slice('--db='.length);
      return options;
    }

    if (arg.startsWith('--downloads-dir=')) {
      options.downloadsDir = arg.slice('--downloads-dir='.length);
      return options;
    }

    if (arg.startsWith('--batch-size=')) {
      options.batchSize = normalizeBatchSize(arg.slice('--batch-size='.length));
      return options;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }, {
    apply: false,
    sqliteDbPath: null,
    downloadsDir: null,
    batchSize: 500
  });
}

function readDownloadedFileRows(sqliteClient, batchSize) {
  const rows = [];
  let lastId = 0;

  while (true) {
    const batch = sqliteClient.query(`
      SELECT id, file_id, file_unique_id, file_name, local_path
      FROM telegram_user_files
      WHERE local_path IS NOT NULL
        AND id > ${toSqlValue(lastId)}
      ORDER BY id ASC
      LIMIT ${toSqlValue(batchSize)};
    `);

    if (batch.length === 0) {
      return rows;
    }

    rows.push(...batch);
    lastId = batch[batch.length - 1].id;
  }
}

function normalizeBatchSize(value) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('--batch-size must be a positive integer');
  }

  return parsed;
}

function buildRenamePlan(rows, downloadsDir) {
  const occupiedPaths = new Set();

  for (const row of rows) {
    if (row.local_path && fs.existsSync(row.local_path)) {
      occupiedPaths.add(path.resolve(row.local_path));
    }
  }

  return rows.map((row) => {
    const currentPath = row.local_path ? path.resolve(row.local_path) : null;

    if (!currentPath || !fs.existsSync(currentPath)) {
      return { row, currentPath, targetPath: null, action: 'skip', reason: 'missing_file' };
    }

    const targetDirectory = path.dirname(currentPath) || downloadsDir;
    const attachment = {
      file_id: row.file_id,
      file_unique_id: row.file_unique_id,
      file_name: row.file_name
    };
    let fileName = chooseLocalFileName(targetDirectory, attachment, currentPath, currentPath);
    let targetPath = path.resolve(targetDirectory, fileName);

    if (pathOccupiedOutsideCurrentPath(occupiedPaths, targetPath, currentPath)) {
      fileName = buildUniqueFileName(row);
      targetPath = path.resolve(targetDirectory, fileName);
    }

    if (pathOccupiedOutsideCurrentPath(occupiedPaths, targetPath, currentPath)) {
      return { row, currentPath, targetPath, action: 'skip', reason: 'target_exists' };
    }

    occupiedPaths.delete(currentPath);
    occupiedPaths.add(targetPath);

    if (currentPath === targetPath) {
      return { row, currentPath, targetPath, action: 'keep', reason: 'already_named' };
    }

    return { row, currentPath, targetPath, action: 'rename', reason: 'needs_rename' };
  });
}

function pathOccupiedOutsideCurrentPath(occupiedPaths, targetPath, currentPath) {
  const resolvedTargetPath = path.resolve(targetPath);

  return occupiedPaths.has(resolvedTargetPath) && resolvedTargetPath !== path.resolve(currentPath);
}

function buildUniqueFileName(row) {
  const originalFileName = row.file_name
    ? sanitizeFileName(path.basename(row.file_name))
    : sanitizeFileName(row.file_unique_id || row.file_id || 'telegram-file');
  const parsed = path.parse(originalFileName);
  const baseName = parsed.name || 'telegram-file';
  const uniqueId = sanitizeFileName(row.file_unique_id || row.file_id);

  return `${baseName}-${uniqueId}${parsed.ext}`;
}

function applyRenamePlan(sqliteClient, plan) {
  for (const item of plan) {
    if (item.action !== 'rename') {
      continue;
    }

    if (fs.existsSync(item.currentPath)) {
      fs.renameSync(item.currentPath, item.targetPath);
      updateLocalPath(sqliteClient, item.row.id, item.targetPath);
      continue;
    }

    if (fs.existsSync(item.targetPath)) {
      console.log(`source already moved #${item.row.id}: updating local_path -> ${item.targetPath}`);
      updateLocalPath(sqliteClient, item.row.id, item.targetPath);
      continue;
    }

    console.log(`skip #${item.row.id} (missing_source): ${item.currentPath}`);
  }
}

function updateLocalPath(sqliteClient, recordId, localPath) {
  sqliteClient.execute(`
    UPDATE telegram_user_files
    SET local_path = ${toSqlValue(localPath)},
        updated_at = datetime('now')
    WHERE id = ${toSqlValue(recordId)};
  `);
}

function printPlan(plan, willApply) {
  const counts = countActions(plan);

  console.log(`${willApply ? 'Applying' : 'Planning'} downloaded file renames.`);
  console.log(`rename=${counts.rename}, keep=${counts.keep}, skip=${counts.skip}`);

  for (const item of plan) {
    if (item.action === 'rename') {
      console.log(`rename #${item.row.id}: ${item.currentPath} -> ${item.targetPath}`);
    } else if (item.action === 'skip') {
      console.log(`skip #${item.row.id} (${item.reason}): ${item.currentPath || item.row.local_path || 'no local_path'}`);
    }
  }
}

function countActions(plan) {
  return plan.reduce((counts, item) => {
    counts[item.action] = (counts[item.action] || 0) + 1;
    return counts;
  }, {
    rename: 0,
    keep: 0,
    skip: 0
  });
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  applyRenamePlan,
  buildRenamePlan,
  readDownloadedFileRows,
  parseArgs
};
