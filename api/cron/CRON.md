## Vercel Cron Jobs

The daily scheduled question send is configured per-chat via the `/cron`
Telegram command and executed by the daily ticker (`/api/cron/ticker`).

### Schedule

- **Endpoint**: `/api/cron/ticker`
- **Schedule**: `0 9 * * *` and `0 10 * * *` UTC — twice daily. Two ticks
  are needed because Vercel Hobby cron is daily-only, so we cover both
  EEST (summer) and EET (winter) for chats in `Europe/Chisinau`. Each
  tick matches each chat's local hour against `tq-bot-chats.cron_time`;
  only the matching tick fires a question.
- **Logic**: Reads `tq-bot-chats` for rows with `cron_enabled = true`,
  fires a question for each chat whose current local hour equals
  `cron_time::hour` and whose `cron_last_sent_at` is not today in the
  chat's timezone (idempotency).

Per-chat timezone defaults to `Europe/Chisinau` and lives on
`tq-bot-chats.timezone`.

### Environment Variables

| Variable                    | Required | Description                                                    |
| --------------------------- | -------- | -------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`        | Yes      | Telegram bot token                                             |
| `SUPABASE_URL`              | Yes      | Supabase project URL                                           |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes      | Server-side key (bypasses RLS; never expose to clients)        |
| `REDIS_URL`                 | No       | Redis connection for answer/hint storage and JWT token caching |
| `CRON_SECRET`               | No       | Optional secret for manual testing                             |

> `CRON_TARGET_CHATS` is no longer used. Configure schedules per-chat via
> `/cron on` and `/cron off`.

### Security

- Vercel automatically adds `x-vercel-cron: true` header to cron requests
- If `CRON_SECRET` is set, manual requests must include `x-cron-secret` header

### Manual Testing

```bash
curl -X POST https://your-vercel-domain.vercel.app/api/cron/ticker \
  -H "x-cron-secret: your-secret-value"
```

The response includes `sent`, `skipped`, and `failed` counts.

### Files

- `api/cron/ticker.ts` — the daily ticker
- `api/handlers/commands/cronCommand.ts` — `/cron` command parser
- `supabase/migrations/0001_init.sql` — DB schema (apply manually)
- `vercel.json` — Cron schedule configuration

### Notes

- Vercel Cron runs in UTC timezone
- Cron jobs have the same timeout limits as serverless functions (10 seconds on free tier, 60 seconds on Pro)
- Idempotency: a chat whose `cron_last_sent_at` is on the current local day
  (in the chat's timezone) is skipped. Setting `cron_enabled = false`
  pauses the daily send without deleting state.
- Up to **1 question per day** per chat, at the chat's `cron_time`
  (default `12:00:00`).
