# AGENTS

## Project Rules

1. Keep Telegram transport code separate from business logic. Message parsing, authorization, deduplication, and file-size decisions must stay in pure modules under `src/domain/` or `src/application/`.
2. Do not introduce a real Telegram Bot API client at this stage. Adapters may only be stubs, contracts, or in-memory fakes.
3. Tests must not perform network requests and must not require a real `TELEGRAM_BOT_TOKEN`.
4. Prefer dependency injection for repositories, queues, and future Telegram gateways so that unit tests can run without side effects.
5. Treat `file_unique_id` as the primary deduplication key. Do not fall back to file names for uniqueness.
6. Use the configured small-file limit from configuration, defaulting to `20 * 1024 * 1024` bytes.
7. Keep modules small and explicit. New behavior should be covered by unit tests before adding transport-level wiring.
8. Preserve CommonJS unless the project is intentionally migrated and the test runner is updated with it.
