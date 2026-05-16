# Telegram File Bot

Stage 1 scaffold for a Telegram bot that will process `document`, `photo`, and `video` attachments. The current state intentionally avoids any real Telegram API integration and focuses on testable domain logic.

## Run

1. Copy `.env.example` to `.env`.
2. Adjust local values if needed.
3. Start the scaffold:

```bash
npm start
```

With a real `TELEGRAM_BOT_TOKEN`, `npm start` runs long polling against Telegram Bot API. It reads message and callback updates, processes messages from users listed in `AUTHORIZED_USER_IDS`, downloads small supported files to `DOWNLOADS_DIR`, stores metadata in `SQLITE_DB_PATH`, and deletes processed source messages when Telegram allows it.

For bursty uploads, the bot processes updates sequentially and advances the Telegram update offset only after an update is handled successfully. Telegram API calls are throttled by `TELEGRAM_API_MIN_REQUEST_INTERVAL_MS`.

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

- `/queue` — show the shared queue of files waiting for manual download, including queue number, file name, size, and status.
- `/clear_queue` — ask for confirmation before clearing the shared queue. Confirmed cleanup marks active queue records as `deleted_by_user`.

Available buttons:

- `Показать следующие вложения` — starts sending queued files.
- `Подтвердить скачивание и показать следующие` — confirms the previous batch as downloaded, then sends the next batch of up to 10 queued files.
- `Подтвердить скачивание` — confirms the final shown batch when there are no more queued files.
- `Очистить очередь` — confirms `/clear_queue`.
- `Отмена` — cancels queue cleanup.

Manual download flow:

1. Send large `photo`, `video`, or `document` files to the bot.
2. Use `/queue` to inspect the queue.
3. Press `Показать следующие вложения`.
4. Download the shown files in Telegram.
5. Press `Подтвердить скачивание и показать следующие` to confirm the previous batch and receive the next one.
6. For the final batch, press `Подтвердить скачивание`.

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
