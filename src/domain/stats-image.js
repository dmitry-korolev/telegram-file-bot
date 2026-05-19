'use strict';

const SIZE_BUCKETS = [
  { key: '0_1_mb', label: '0-1 MB', minBytes: 0, maxBytes: 1 * 1024 * 1024 },
  { key: '1_5_mb', label: '1-5 MB', minBytes: 1 * 1024 * 1024, maxBytes: 5 * 1024 * 1024 },
  { key: '5_20_mb', label: '5-20 MB', minBytes: 5 * 1024 * 1024, maxBytes: 20 * 1024 * 1024 },
  { key: '20_50_mb', label: '20-50 MB', minBytes: 20 * 1024 * 1024, maxBytes: 50 * 1024 * 1024 },
  { key: '50_100_mb', label: '50-100 MB', minBytes: 50 * 1024 * 1024, maxBytes: 100 * 1024 * 1024 },
  { key: '100_500_mb', label: '100-500 MB', minBytes: 100 * 1024 * 1024, maxBytes: 500 * 1024 * 1024 },
  { key: '500_1000_mb', label: '500-1000 MB', minBytes: 500 * 1024 * 1024, maxBytes: 1000 * 1024 * 1024 },
  { key: '1000_plus_mb', label: '1000+ MB', minBytes: 1000 * 1024 * 1024, maxBytes: null }
];

const KIND_COLORS = {
  document: '#2F80ED',
  photo: '#27AE60',
  video: '#F2994A'
};

const STATUS_COLORS = {
  downloaded: '#27AE60',
  queue: '#2F80ED',
  confirmed: '#9B51E0',
  failed: '#EB5757'
};

function buildStatsImageModel(data) {
  const normalizedData = data || {};
  const stats = normalizedData.stats || {};
  const sizeBucketsByKey = normalizeCountMap(normalizedData.sizeBuckets);
  const kindCounts = {
    document: normalizeCount(readNested(normalizedData.kindCounts, 'document', stats.documentFiles)),
    photo: normalizeCount(readNested(normalizedData.kindCounts, 'photo', stats.photoFiles)),
    video: normalizeCount(readNested(normalizedData.kindCounts, 'video', stats.videoFiles))
  };
  const statusCounts = {
    downloaded: normalizeCount(readNested(normalizedData.statusCounts, 'downloaded', stats.downloadedFiles)),
    queue: normalizeCount(readNested(normalizedData.statusCounts, 'queue', stats.activeQueueFiles)),
    confirmed: normalizeCount(readNested(normalizedData.statusCounts, 'confirmed', stats.downloadConfirmedFiles)),
    failed: normalizeCount(readNested(normalizedData.statusCounts, 'failed', stats.failedFiles))
  };
  const maxBucketCount = SIZE_BUCKETS.reduce((max, bucket) => Math.max(max, normalizeCount(sizeBucketsByKey[bucket.key])), 0);
  const maxBucketScale = maxBucketCount > 0 ? Math.log10(maxBucketCount + 1) : 1;

  return {
    title: 'Статистика бота',
    subtitle: 'Файлы, очередь и типы вложений',
    kpis: [
      { label: 'Всего файлов', value: formatInteger(stats.totalFiles) },
      { label: 'Известный объем', value: formatFileSize(stats.totalKnownSize) },
      { label: 'Активная очередь', value: formatInteger(stats.activeQueueFiles) },
      { label: 'Дубликаты', value: formatInteger(stats.duplicateFiles) },
      { label: 'Ошибки', value: formatInteger(stats.failedFiles) }
    ],
    sizeBuckets: SIZE_BUCKETS.map((bucket) => {
      const count = normalizeCount(sizeBucketsByKey[bucket.key]);

      return {
        key: bucket.key,
        label: bucket.label,
        count,
        ratio: maxBucketCount > 0 ? Math.log10(count + 1) / maxBucketScale : 0
      };
    }),
    kindSegments: buildSegments([
      { key: 'document', label: 'Documents', count: kindCounts.document, color: KIND_COLORS.document },
      { key: 'photo', label: 'Photos', count: kindCounts.photo, color: KIND_COLORS.photo },
      { key: 'video', label: 'Videos', count: kindCounts.video, color: KIND_COLORS.video }
    ]),
    statusSegments: buildSegments([
      { key: 'downloaded', label: 'Авто', count: statusCounts.downloaded, color: STATUS_COLORS.downloaded },
      { key: 'queue', label: 'Очередь', count: statusCounts.queue, color: STATUS_COLORS.queue },
      { key: 'confirmed', label: 'Ручные', count: statusCounts.confirmed, color: STATUS_COLORS.confirmed },
      { key: 'failed', label: 'Ошибки', count: statusCounts.failed, color: STATUS_COLORS.failed }
    ])
  };
}

function buildStatsImageSvg(model) {
  const normalizedModel = model || buildStatsImageModel({});
  const width = 1300;
  const height = 820;
  const barX = 250;
  const barMaxWidth = 520;
  const barHeight = 28;
  const barGap = 18;
  const firstSectionTitleY = 270;
  const firstSectionContentY = 305;
  const countX = barX + barMaxWidth + 24;
  const rightColumnX = 880;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<rect width="' + width + '" height="' + height + '" fill="#F6F7F9"/>',
    '<rect x="44" y="38" width="1212" height="744" fill="#FFFFFF"/>',
    text(80, 98, normalizedModel.title, 44, 700, '#111827'),
    text(80, 135, normalizedModel.subtitle, 22, 400, '#6B7280'),
    buildKpiCards(normalizedModel.kpis),
    text(80, firstSectionTitleY, 'Распределение по размеру', 28, 700, '#111827'),
    normalizedModel.sizeBuckets.map((bucket, index) => {
      const y = firstSectionContentY + index * (barHeight + barGap);
      const barWidth = Math.max(4, Math.round(bucket.ratio * barMaxWidth));
      const visibleWidth = bucket.count > 0 ? barWidth : 0;

      return [
        text(80, y + 21, bucket.label, 18, 600, '#374151'),
        '<rect x="' + barX + '" y="' + y + '" width="' + barMaxWidth + '" height="' + barHeight + '" fill="#E5E7EB"/>',
        '<rect x="' + barX + '" y="' + y + '" width="' + visibleWidth + '" height="' + barHeight + '" fill="#2F80ED"/>',
        text(countX, y + 21, formatInteger(bucket.count), 18, 700, '#111827')
      ].join('');
    }).join(''),
    text(rightColumnX, firstSectionTitleY, 'Типы вложений', 28, 700, '#111827'),
    buildStackedBar(rightColumnX, firstSectionContentY, 320, 30, normalizedModel.kindSegments),
    buildLegend(rightColumnX, firstSectionContentY + 55, normalizedModel.kindSegments),
    text(rightColumnX, 510, 'Статусы обработки', 28, 700, '#111827'),
    buildStackedBar(rightColumnX, 545, 320, 30, normalizedModel.statusSegments),
    buildLegend(rightColumnX, 600, normalizedModel.statusSegments),
    '</svg>'
  ].join('');
}

function buildKpiCards(kpis) {
  return (Array.isArray(kpis) ? kpis : []).map((kpi, index) => {
    const x = 80 + index * 232;

    return [
      '<rect x="' + x + '" y="165" width="205" height="52" fill="#F3F4F6"/>',
      text(x + 16, 187, kpi.label, 14, 500, '#6B7280'),
      text(x + 16, 207, kpi.value, 20, 700, '#111827')
    ].join('');
  }).join('');
}

function buildStackedBar(x, y, width, height, segments) {
  const normalizedSegments = Array.isArray(segments) ? segments : [];
  const positiveSegments = normalizedSegments.filter((segment) => segment.count > 0);

  if (positiveSegments.length === 0) {
    return '<rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" fill="#E5E7EB"/>';
  }

  let currentX = x;

  return positiveSegments.map((segment, index) => {
    const segmentWidth = index === positiveSegments.length - 1
      ? x + width - currentX
      : Math.round(width * segment.ratio);
    const output = '<rect x="' + currentX + '" y="' + y + '" width="' + Math.max(1, segmentWidth) + '" height="' + height + '" fill="' + segment.color + '"/>';
    currentX += segmentWidth;
    return output;
  }).join('');
}

function buildLegend(x, y, segments) {
  return (Array.isArray(segments) ? segments : []).map((segment, index) => {
    const rowY = y + index * 34;
    const percent = segment.total > 0 ? ` (${Math.round(segment.ratio * 100)}%)` : '';

    return [
      '<rect x="' + x + '" y="' + (rowY - 14) + '" width="16" height="16" fill="' + segment.color + '"/>',
      text(x + 28, rowY, `${segment.label}: ${formatInteger(segment.count)}${percent}`, 18, 500, '#374151')
    ].join('');
  }).join('');
}

function buildSegments(items) {
  const normalizedItems = Array.isArray(items) ? items : [];
  const total = normalizedItems.reduce((sum, item) => sum + normalizeCount(item.count), 0);

  return normalizedItems.map((item) => {
    const count = normalizeCount(item.count);

    return {
      key: item.key,
      label: item.label,
      count,
      color: item.color,
      total,
      ratio: total > 0 ? count / total : 0
    };
  });
}

function text(x, y, value, fontSize, fontWeight, fill) {
  return '<text x="' + x + '" y="' + y + '" font-family="Arial, Helvetica, sans-serif" font-size="' + fontSize + '" font-weight="' + fontWeight + '" fill="' + fill + '">' + escapeXml(value) + '</text>';
}

function formatInteger(value) {
  return String(normalizeCount(value));
}

function formatFileSize(value) {
  const bytes = normalizeCount(value);
  const megabytes = bytes / 1024 / 1024;

  if (bytes === 0) {
    return '0 KB';
  }

  if (megabytes >= 1024) {
    return `${(megabytes / 1024).toFixed(1)} GB`;
  }

  if (megabytes >= 1) {
    return `${megabytes.toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function normalizeCountMap(value) {
  return value && typeof value === 'object' ? value : {};
}

function readNested(object, key, fallback) {
  if (object && Object.prototype.hasOwnProperty.call(object, key)) {
    return object[key];
  }

  return fallback;
}

function normalizeCount(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function escapeXml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = {
  SIZE_BUCKETS,
  buildStatsImageModel,
  buildStatsImageSvg,
  formatFileSize
};
