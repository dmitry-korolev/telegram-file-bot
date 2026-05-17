'use strict';

function isCommandMessage(message) {
  return Boolean(message && typeof message.text === 'string' && message.text.trim().startsWith('/'));
}

function getCommandName(message) {
  if (!isCommandMessage(message)) {
    return null;
  }

  return message.text.trim().split(/\s+/)[0].split('@')[0];
}

function createShowNextFilesKeyboard(options) {
  const normalizedOptions = options || {};
  const includeSizeButtons = normalizedOptions.includeSizeButtons !== false;
  const keyboard = [
    [
      {
        text: 'Показать следующие вложения',
        callback_data: 'show_next_files'
      }
    ]
  ];

  if (includeSizeButtons) {
    keyboard.push([
      {
        text: '10 самых больших',
        callback_data: 'show_largest_files'
      },
      {
        text: '10 самых маленьких',
        callback_data: 'show_smallest_files'
      }
    ]);
  }

  return {
    inline_keyboard: keyboard
  };
}

function createClearQueueConfirmationKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: 'Очистить очередь',
          callback_data: 'confirm_clear_queue'
        },
        {
          text: 'Отмена',
          callback_data: 'cancel_clear_queue'
        }
      ]
    ]
  };
}

function buildQueueMessage(files) {
  const normalizedFiles = Array.isArray(files) ? files : [];

  if (normalizedFiles.length === 0) {
    return 'В очереди нет файлов для ручного скачивания.';
  }

  const totalSize = normalizedFiles.reduce((sum, file) => {
    if (!Number.isFinite(file.file_size)) {
      return sum;
    }

    return sum + file.file_size;
  }, 0);
  const unknownSizeCount = normalizedFiles.filter((file) => !Number.isFinite(file.file_size)).length;
  const unknownSizeText = unknownSizeCount > 0 ? `, файлов с неизвестным размером: ${unknownSizeCount}` : '';

  return `В очереди файлов: ${normalizedFiles.length}. Суммарный объем: ${formatFileSize(totalSize)}${unknownSizeText}.`;
}

function buildQueueSummaryMessage(summary) {
  const normalizedSummary = summary || {};
  const fileCount = normalizedSummary.fileCount || 0;

  if (fileCount === 0) {
    return 'В очереди нет файлов для ручного скачивания.';
  }

  const unknownSizeCount = normalizedSummary.unknownSizeFiles || 0;
  const unknownSizeText = unknownSizeCount > 0 ? `, файлов с неизвестным размером: ${unknownSizeCount}` : '';

  return `В очереди файлов: ${fileCount}. Суммарный объем: ${formatFileSize(normalizedSummary.totalKnownSize || 0)}${unknownSizeText}.`;
}

function buildStatsMessage(stats) {
  const normalizedStats = stats || {};

  return [
    'Статистика бота:',
    `Всего файлов: ${normalizedStats.totalFiles || 0}`,
    `Общий известный объем: ${formatFileSize(normalizedStats.totalKnownSize || 0)}`,
    `Активная очередь: ${normalizedStats.activeQueueFiles || 0} файлов, ${formatFileSize(normalizedStats.activeQueueKnownSize || 0)}`,
    `Скачано автоматически: ${normalizedStats.downloadedFiles || 0}`,
    `Подтверждено ручных скачиваний: ${normalizedStats.downloadConfirmedFiles || 0}`,
    `Отсеяно дубликатов: ${normalizedStats.duplicateFiles || 0}`,
    `Ошибок: ${normalizedStats.failedFiles || 0}`,
    `Типы: documents - ${normalizedStats.documentFiles || 0}, photos - ${normalizedStats.photoFiles || 0}, videos - ${normalizedStats.videoFiles || 0}`,
    `Файлов с неизвестным размером: ${normalizedStats.unknownSizeFiles || 0}`
  ].join('\n');
}

function buildShownFilesMessage(shownCount, remainingCount) {
  if (shownCount === 0) {
    return remainingCount > 0 ? 'Не удалось показать файлы из очереди.' : 'Больше файлов в очереди нет.';
  }

  if (remainingCount > 0) {
    return `Показано вложений: ${shownCount}. Они отмечены как скачанные. Осталось в очереди: ${remainingCount}.`;
  }

  return `Показано вложений: ${shownCount}. Они отмечены как скачанные. Осталось в очереди: 0.`;
}

function buildClearQueuePrompt() {
  return 'Очистить очередь больших файлов? Это действие пометит текущие записи очереди как удаленные пользователем.';
}

function buildClearQueueConfirmedMessage(updatedCount) {
  return `Очередь очищена. Записей обновлено: ${updatedCount}.`;
}

function buildProcessingResponse(files) {
  const normalizedFiles = Array.isArray(files) ? files : [];

  if (normalizedFiles.length === 0) {
    return null;
  }

  if (normalizedFiles.length === 1) {
    return buildSingleFileResponse(normalizedFiles[0]);
  }

  const counts = countFileStatuses(normalizedFiles);

  return `Итог: скачано ${counts.downloaded}, в очереди ${counts.queued}, дубликатов ${counts.duplicates}, ошибок ${counts.errors}.`;
}

function buildSingleFileResponse(file) {
  const fileName = file.fileName || defaultFileName(file.fileKind);

  if (file.status === 'downloaded') {
    return `Файл "${fileName}" скачан.`;
  }

  if (file.status === 'pending_manual_download') {
    return `Файл "${fileName}" добавлен в очередь.`;
  }

  if (file.status === 'duplicate_skipped') {
    return `Файл "${fileName}" уже был раньше.`;
  }

  if (file.status === 'pending_size_unknown') {
    return `Файл "${fileName}" добавлен в очередь, размер неизвестен.`;
  }

  if (file.status === 'download_failed') {
    return `Файл "${fileName}" не удалось скачать.`;
  }

  return `Файл "${fileName}" обработан со статусом ${file.status}.`;
}

function countFileStatuses(files) {
  return files.reduce((counts, file) => {
    if (file.status === 'downloaded') {
      counts.downloaded += 1;
    } else if (file.status === 'pending_manual_download' || file.status === 'pending_size_unknown') {
      counts.queued += 1;
    } else if (file.status === 'duplicate_skipped') {
      counts.duplicates += 1;
    } else if (file.status.endsWith('_failed')) {
      counts.errors += 1;
    }

    return counts;
  }, {
    downloaded: 0,
    queued: 0,
    duplicates: 0,
    errors: 0
  });
}

function defaultFileName(fileKind) {
  if (fileKind === 'photo') {
    return 'photo.jpg';
  }

  if (fileKind === 'video') {
    return 'video';
  }

  return 'file';
}

function formatFileSize(fileSize) {
  if (!Number.isFinite(fileSize)) {
    return 'размер неизвестен';
  }

  const megabytes = fileSize / 1024 / 1024;

  if (megabytes >= 1) {
    return `${megabytes.toFixed(1)} МБ`;
  }

  return `${Math.max(1, Math.round(fileSize / 1024))} КБ`;
}

module.exports = {
  isCommandMessage,
  getCommandName,
  createShowNextFilesKeyboard,
  createClearQueueConfirmationKeyboard,
  buildQueueMessage,
  buildQueueSummaryMessage,
  buildStatsMessage,
  buildShownFilesMessage,
  buildClearQueuePrompt,
  buildClearQueueConfirmedMessage,
  buildProcessingResponse,
  buildSingleFileResponse,
  countFileStatuses,
  formatFileSize
};
