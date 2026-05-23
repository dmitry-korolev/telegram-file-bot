'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { applyRenamePlan, buildRenamePlan, readDownloadedFileRows } = require('../scripts/rename-downloaded-files');

function runTests() {
  testBuildRenamePlanUsesOriginalNameAndUniqueSuffixOnConflict();
  testReadDownloadedFileRowsUsesBatches();
  testApplyRenamePlanUpdatesLocalPathWhenSourceWasAlreadyMoved();
}

function testBuildRenamePlanUsesOriginalNameAndUniqueSuffixOnConflict() {
  withDownloadsDir((downloadsDir) => {
    const firstCurrentPath = path.resolve(downloadsDir, 'unique-1.pdf');
    const secondCurrentPath = path.resolve(downloadsDir, 'unique-2.pdf');
    fs.writeFileSync(firstCurrentPath, 'first');
    fs.writeFileSync(secondCurrentPath, 'second');

    const plan = buildRenamePlan([
      {
        id: 1,
        file_id: 'file-1',
        file_unique_id: 'unique-1',
        file_name: 'report.pdf',
        local_path: firstCurrentPath
      },
      {
        id: 2,
        file_id: 'file-2',
        file_unique_id: 'unique-2',
        file_name: 'report.pdf',
        local_path: secondCurrentPath
      }
    ], downloadsDir);

    assert.strictEqual(plan[0].action, 'rename');
    assert.strictEqual(plan[0].targetPath, path.resolve(downloadsDir, 'report.pdf'));
    assert.strictEqual(plan[1].action, 'rename');
    assert.strictEqual(plan[1].targetPath, path.resolve(downloadsDir, 'report-unique-2.pdf'));
  });
}

function testReadDownloadedFileRowsUsesBatches() {
  const queries = [];
  const rows = [
    { id: 1, local_path: '/tmp/1' },
    { id: 2, local_path: '/tmp/2' },
    { id: 3, local_path: '/tmp/3' }
  ];
  const sqliteClient = {
    query(sql) {
      queries.push(sql);
      const match = sql.match(/id > (\d+)/);
      const lastId = match ? Number(match[1]) : 0;
      return rows.filter((row) => row.id > lastId).slice(0, 2);
    }
  };

  const result = readDownloadedFileRows(sqliteClient, 2);

  assert.deepStrictEqual(result.map((row) => row.id), [1, 2, 3]);
  assert.strictEqual(queries.length, 3);
  assert.strictEqual(queries.every((sql) => sql.includes('LIMIT 2')), true);
}

function testApplyRenamePlanUpdatesLocalPathWhenSourceWasAlreadyMoved() {
  withDownloadsDir((downloadsDir) => {
    const sourcePath = path.resolve(downloadsDir, 'unique-1.jpg');
    const targetPath = path.resolve(downloadsDir, 'photo-unique-1.jpg');
    fs.writeFileSync(targetPath, 'already moved');

    const updates = [];
    const sqliteClient = {
      execute(sql) {
        updates.push(sql);
      }
    };

    applyRenamePlan(sqliteClient, [
      {
        row: { id: 1 },
        currentPath: sourcePath,
        targetPath,
        action: 'rename'
      }
    ]);

    assert.strictEqual(updates.length, 1);
    assert.strictEqual(updates[0].includes(`local_path = '${targetPath}'`), true);
  });
}

function withDownloadsDir(callback) {
  const downloadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rename-downloaded-files-'));

  try {
    callback(downloadsDir);
  } finally {
    fs.rmSync(downloadsDir, { recursive: true, force: true });
  }
}

module.exports = {
  runTests
};
