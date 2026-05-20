# Telegram File Bot

English | [Русский](README.ru.md)

Telegram bot for processing `document`, `photo`, and `video` attachments with automatic small-file downloads and a shared manual-download queue for large files.

## Run

1. Copy `.env.example` to `.env`.
2. Adjust local values if needed.
3. Start the scaffold:

```bash
npm start
```

With a real `TELEGRAM_BOT_TOKEN`, `npm start` runs long polling against Telegram Bot API. It reads message and callback updates, processes messages from users listed in `AUTHORIZED_USER_IDS`, downloads small supported files to `DOWNLOADS_DIR`, stores metadata in `SQLITE_DB_PATH`, and deletes processed source messages when Telegram allows it.

For bursty uploads, the bot processes updates sequentially and advances the Telegram update offset only after an update is handled successfully. Telegram API calls are throttled by `TELEGRAM_API_MIN_REQUEST_INTERVAL_MS`.

For Telegram media groups, file processing starts immediately for every update, but the bot sends one aggregated summary after `MEDIA_GROUP_RESPONSE_DELAY_MS` milliseconds without new updates for the same group.

Development mode with file watching:

```bash
npm run dev
```

## Bot Usage

Only users listed in `AUTHORIZED_USER_IDS` can use the bot. The queue and deduplication are shared across all authorized users.

Send the bot one of the supported attachment types:

- `document`
- `photo`
- `video`

Unsupported attachments such as `audio`, `voice`, `sticker`, `animation`, and plain non-command text messages are ignored. Non-command messages without supported attachments are deleted when possible.

Small files up to `SMALL_FILE_LIMIT_BYTES` are downloaded automatically to `DOWNLOADS_DIR`. Files larger than the limit are saved to the shared manual-download queue.

Available commands:

- `/queue` — show the shared queue summary: file count and total known size.
- `/show_archive` — show the archive summary and buttons for archived files.
- `/archive` — when sent as a reply to media previously sent by the bot, move that file to the archive.
- `/stats` — show aggregate bot statistics: total files, known total size, active queue size, downloaded files, confirmed manual downloads, duplicates, errors, and attachment types.
- `/stats_image` — send aggregate bot statistics as a PNG image with charts for file sizes, attachment types, and processing statuses.
- `/clear_queue` — ask for confirmation before clearing the shared queue. Confirmed cleanup marks active queue records as `deleted_by_user`.

Available buttons:

- `Показать следующие вложения` — sends the next batch of up to 10 queued files. Successfully sent files are immediately marked as `download_confirmed`.
- `10 самых больших` — sends up to 10 queued files with the largest known size.
- `10 самых маленьких` — sends up to 10 queued files with the smallest known size.
- `Очистить очередь` — confirms `/clear_queue`.
- `Отмена` — cancels queue cleanup.

The same next/largest/smallest buttons are used for `/show_archive`, but they operate on archived files. Files shown from the archive are removed from the archive and marked as `download_confirmed`.

Manual download flow:

1. Send large `photo`, `video`, or `document` files to the bot.
2. Use `/queue` to inspect the queue.
3. Press `Показать следующие вложения`.
4. Download the shown files in Telegram.
5. If the queue still has files, press `Показать следующие вложения` again to receive the next batch.

The bot prioritizes large `photo` and `video` files before `document` files.

## Tests

```bash
npm test
```

The test suite uses only local Node.js modules and does not make network requests.

## Docker

Build the image:

```bash
docker build -t telegram-file-bot:stage1 .
```

Run the container:

```bash
docker run --rm telegram-file-bot:stage1
```

## Structure

- `src/application/` — orchestration of message processing.
- `src/domain/` — pure business rules.
- `src/adapters/` — placeholders for future Telegram and storage adapters.
- `tests/` — unit tests and a minimal local test runner.
