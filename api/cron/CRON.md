## Vercel Cron Jobs

Scheduled sends are configured per-chat via the `/cron` Telegram command and
executed by the hourly ticker (`/api/cron/ticker`).

### Schedule

- **Endpoint**: `/api/cron/ticker`
- **Schedule**: `0 * * * *` (every hour, on the hour, UTC) — Vercel Hobby tier
- **Logic**: Reads `tq-bot-cron_jobs` from Supabase, sends a question for any
  enabled job whose `send_at` hour matches the current local hour in the
  chat's timezone.

Per-chat timezone defaults to `Europe/Moscow` and is read from `tq-bot-chats`.

### Environment Variables

| Variable                    | Required | Description                                                    |
| --------------------------- | -------- | -------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`        | Yes      | Telegram bot token                                             |
| `SUPABASE_URL`              | Yes      | Supabase project URL                                           |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes      | Server-side key (bypasses RLS; never expose to clients)        |
| `REDIS_URL`                 | No       | Redis connection for answer/hint storage and JWT token caching |
| `CRON_SECRET`               | No       | Optional secret for manual testing                             |

> `CRON_TARGET_CHATS` is no longer used. Configure schedules per-chat via
> `/cron add HH:MM`.

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

- `api/cron/ticker.ts` — the hourly ticker
- `api/handlers/commands/cronCommand.ts` — `/cron` command parser
- `supabase/migrations/0001_init.sql` — DB schema (apply manually)
- `vercel.json` — Cron schedule configuration

### Notes

- Vercel Cron runs in UTC timezone
- Cron jobs have the same timeout limits as serverless functions (10 seconds on free tier, 60 seconds on Pro)
- Idempotency: a job whose `last_sent_at` is on the current local day (in the chat's
  timezone) is skipped, so the 12-jobs-per-chat cap is naturally enforced even if
  Vercel fires twice.
- Up to 12 jobs per chat (`MAX_JOBS_PER_CHAT` in `src/services/cronConfig.ts`).
- Hour resolution: `/cron add 12:30` stores `"12:30:00"` but the ticker matches on
  the hour only. The minute is preserved for display.
