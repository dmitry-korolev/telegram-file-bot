'use strict';

const assert = require('assert');

const { renderStatsImage } = require('../src/application/stats-image-renderer');
const { buildStatsImageModel, buildStatsImageSvg, formatFileSize } = require('../src/domain/stats-image');

async function runTests() {
  testBuildStatsImageModelHandlesEmptyData();
  testBuildStatsImageModelUsesLargeBuckets();
  testBuildStatsImageSvgRendersCoreSections();
  await testRenderStatsImageReturnsPng();
}

function testBuildStatsImageModelHandlesEmptyData() {
  const model = buildStatsImageModel({});

  assert.strictEqual(model.kpis[0].value, '0');
  assert.strictEqual(model.kpis[1].value, '0 KB');
  assert.strictEqual(model.sizeBuckets.length, 8);
  assert.strictEqual(model.sizeBuckets.every((bucket) => bucket.count === 0), true);
  assert.strictEqual(model.kindSegments.every((segment) => segment.total === 0), true);
}

function testBuildStatsImageModelUsesLargeBuckets() {
  const model = buildStatsImageModel({
    stats: {
      totalFiles: 4,
      totalKnownSize: 1530 * 1024 * 1024,
      activeQueueFiles: 1,
      duplicateFiles: 2,
      failedFiles: 1
    },
    sizeBuckets: {
      '500_1000_mb': 3,
      '1000_plus_mb': 1
    },
    kindCounts: {
      document: 1,
      photo: 1,
      video: 2
    },
    statusCounts: {
      downloaded: 1,
      queue: 1,
      confirmed: 1,
      failed: 1
    }
  });

  assert.strictEqual(model.sizeBuckets.find((bucket) => bucket.key === '500_1000_mb').count, 3);
  assert.strictEqual(model.sizeBuckets.find((bucket) => bucket.key === '1000_plus_mb').count, 1);
  assert.strictEqual(model.kindSegments.find((segment) => segment.key === 'video').ratio, 0.5);
  assert.strictEqual(formatFileSize(1530 * 1024 * 1024), '1.5 GB');
}

function testBuildStatsImageSvgRendersCoreSections() {
  const svg = buildStatsImageSvg(buildStatsImageModel({
    stats: {
      totalFiles: 1,
      totalKnownSize: 1024 * 1024
    },
    sizeBuckets: {
      '1_5_mb': 1
    }
  }));

  assert.strictEqual(svg.includes('<svg'), true);
  assert.strictEqual(svg.includes('DejaVu Sans'), true);
  assert.strictEqual(svg.includes('Статистика бота'), true);
  assert.strictEqual(svg.includes('Распределение по размеру'), true);
  assert.strictEqual(svg.includes('1000+ MB'), true);
  assert.strictEqual(svg.includes('rx='), false);
}

async function testRenderStatsImageReturnsPng() {
  const png = await renderStatsImage({
    stats: {
      totalFiles: 1,
      totalKnownSize: 1024 * 1024
    },
    sizeBuckets: {
      '1_5_mb': 1
    }
  });

  assert.strictEqual(Buffer.isBuffer(png), true);
  assert.deepStrictEqual(Array.from(png.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
}

module.exports = {
  runTests
};
