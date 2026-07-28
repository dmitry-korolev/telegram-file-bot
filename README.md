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

On startup, the bot also syncs its Telegram command menu with the supported commands.

For bursty uploads, the bot processes updates sequentially and advances the Telegram update offset only after an update is handled successfully. Telegram API calls are throttled by `TELEGRAM_API_MIN_REQUEST_INTERVAL_MS`. User-visible outgoing messages and media are additionally sent through one shared queue controlled by `TELEGRAM_OUTGOING_MESSAGE_INTERVAL_MS`, defaulting to 250 ms.

For Telegram media groups, file processing and responses start immediately for every update. The bot sends a separate message for each processed file.

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

When the first caption line looks like `⭐ Dr Strange (VIP)` or `💎 Goblin Slayer (platinum)`, the bot stores the text between the emoji and level as the file author. A second line is optional and ignored during author recognition. Automatically downloaded `document`, `photo`, and `video` attachments with an author go to `DOWNLOADS_DIR/<author>/`; other files keep the date-based layout.

Telegram albums usually include the caption only on their first item. The bot carries the recognized author across every attachment with the same `media_group_id` without delaying per-item processing.

Available commands:

- `/show_queue` — show the shared queue summary: file count and total known size.
- `/search_queue <search_term>` — search queued files by original file name or author and show the same next/largest/smallest buttons for matching files.
- `/queue` — when sent as a reply to media previously sent by the bot, return that file to the queue as not downloaded.
- `/show_archive` — show the archive summary and buttons for archived files.
- `/search_archive <search_term>` — search archived files by original file name or author and show the same next/largest/smallest buttons for matching files.
- `/archive` — when sent as a reply to media previously sent by the bot, move that file to the archive.
- `/stats` — show aggregate bot statistics: total files, known total size, active queue size, downloaded files, confirmed manual downloads, duplicates, errors, and attachment types.
- `/stats_image` — send aggregate bot statistics as a PNG image with charts for file sizes, attachment types, and processing statuses.
- `/clear_queue` — ask for confirmation before clearing the shared queue. Confirmed cleanup marks active queue records as `deleted_by_user`.

Available buttons:

- `Показать следующие вложения` — sends the next batch of up to 10 queued files. Successfully sent files are immediately marked as `download_confirmed`.
- `10 самых больших` — sends up to 10 queued files with the largest known size.
- `10 самых маленьких` — sends up to 10 queued files with the smallest known size.
- `Показать возможные дубликаты` — sends a group of at least two pending files with the same exact known byte size. Groups are ordered by aggregate size (`one file size × files in group`) from largest to smallest; ties prefer the larger individual file size. Successfully sent files are immediately marked as `download_confirmed`.
- `Вернуть в очередь` — returns that specific delivered file to the queue as not downloaded.
- `Вернуть в архив` — returns that specific delivered file to the archive.
- `Очистить очередь` — confirms `/clear_queue`.
- `Отмена` — cancels queue cleanup.

The same next/largest/smallest buttons are used for `/show_archive`, but they operate on archived files. Files shown from the archive are removed from the archive and marked as `download_confirmed`. The possible-duplicates button is only shown for the main queue.

Every file delivered from the queue, search results, a potential-duplicate group, or the archive immediately includes the `Вернуть в очередь` and `Вернуть в архив` buttons. The `/queue` and `/archive` reply commands remain available as an alternative.

To migrate already downloaded local files to the current naming rule, first inspect the plan:

```bash
npm run rename:downloads
```

Apply the renames and update `local_path` in SQLite:

```bash
npm run rename:downloads -- --apply
```

Manual download flow:

1. Send large `photo`, `video`, or `document` files to the bot.
2. Use `/show_queue` to inspect the queue.
3. Press `Показать следующие вложения`.
4. Download the shown files in Telegram.
5. If the queue still has files, press `Показать следующие вложения` again to receive the next batch.

The bot prioritizes large `photo` and `video` files before `document` files.

When a queued file has an author, that name is used as the file's only caption during manual delivery.

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
