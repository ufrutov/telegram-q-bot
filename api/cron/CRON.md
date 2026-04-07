# Vercel Cron Job Setup

Sends daily questions to subscribed Telegram chats.

## Current Configuration

- **Endpoint**: `/api/cron/daily-question`
- **Schedule**: Every day at 12:00 GMT+3 (09:00 UTC)
- **Complexity**: Random question

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Telegram bot token |
| `CRON_TARGET_CHATS` | Yes | Comma-separated chat IDs (e.g., `123456,789012`) |
| `CRON_SECRET` | No | Optional secret for manual testing |
| `REDIS_URL` | No | Redis connection for answer/hint storage |

## Security

- Vercel automatically adds `x-vercel-cron: true` header to cron requests
- If `CRON_SECRET` is set, requests must include `x-cron-secret` header

## Manual Testing

```bash
curl -X POST https://your-vercel-domain.vercel.app/api/cron/daily-question \
  -H "x-cron-secret: your-secret-value"
```

## Files

- `api/cron/daily-question.js` - Cron endpoint implementation
- `vercel.json` - Cron schedule configuration

## Notes

- Vercel Cron runs in UTC timezone
- Cron jobs have the same timeout limits as serverless functions (10 seconds on free tier, 60 seconds on Pro)
- Chat IDs must be numeric strings without special characters