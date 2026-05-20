## Summary

Add support for Telegram supergroups with **forum topics** enabled. Previously the bot ignored `message_thread_id` from incoming updates, causing all replies to land in the General topic. Now every outgoing message respects the active topic context.

## Changes

### `src/services/questionSender.js`
- Added `threadId` (6th param) to `sendQuestionMessage`
- All outgoing calls (`sendMessage`, `sendMediaGroup`) conditionally include `message_thread_id`
- `threadOpts` helper ensures the field is only sent when `threadId` is truthy (harmless for non-forum chats)

### `api/webhook.js`
- **Message handler**: extracts `threadId = update.message.message_thread_id`
- **Callback query handler**: extracts `threadId = callbackQuery.message?.message_thread_id`
- `threadId` forwarded to:
  - `sendQuestionMessage` (both `/question` command and menu callback)
  - All `sendMessage`/`sendMediaGroup` calls (menu, answer expired, answer images/text, hint loading, hint result)

### `api/cron/daily-question.js`
- `CRON_TARGET_CHATS` now supports `{chat_id}_{thread_id}` format alongside plain `{chat_id}`
- Example: `123456,123456_42,99999_9,88888`
- Parsed entries passed as `{ chatId, threadId }` to the sender

### `api/cron/CRON.md`
- Updated env var description to document the new format

### `README.md`
- Complete rewrite to reflect current project state:
  - Full directory tree
  - Commands table (`/question`, `/menu`, complexity suffixes)
  - All 5 env vars with descriptions
  - API routes table
  - Dedicated **Forum Topic Support** section

## Redis compatibility

No changes to Redis keys, values, TTL, or operations. Backward compatible.

## Verification

- All 3 files pass `node -c` syntax checks
- Non-forum chats: `threadId` is `undefined` → `threadOpts` is `{}` → no `message_thread_id` sent
- Cron parsing regex `^(-?\d+)(?:_(\d+))?$` handles negative chat IDs and optional thread IDs
