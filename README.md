# telegram-q-bot

Telegram Question Bot ("Что? Где? Когда?") — deployed on Vercel as serverless functions.

## Features

- **Random questions** — `/question` or `/menu` to pick by difficulty (easy/medium/hard)
- **AI hints** — OpenRouter generates logical hints without revealing the answer
- **Daily cron** — auto-sends a question to configured chats at 12:00 GMT+3
- **Forum topics** — fully supports Telegram supergroups with forum topics
- **Multi-source** — questions from `gotquestions.online` (primary) and `questions.chgk.info` (fallback)

## Project Structure

```
telegram-q-bot/
├── api/
│   ├── webhook.js               # Telegram webhook handler
│   └── cron/
│       └── daily-question.js    # Scheduled question sender
├── src/
│   ├── services/
│   │   ├── questionSender.js    # Shared send logic (webhook + cron)
│   │   └── openrouter.js        # AI hint generation via OpenRouter
│   ├── utils/
│   │   ├── markdown.js          # Telegram MarkdownV2 escaping
│   │   └── date.js              # Russian date formatting
│   └── lib/
│       └── QuestionLoader/      # Question source loaders (factory pattern)
│           ├── QuestionLoader.js
│           ├── BaseQuestionLoader.js
│           ├── GotQuestionsOnlineLoader.js
│           └── ChgkInfoQuestionLoader.js
├── package.json
├── vercel.json
├── .github/workflows/
│   └── deploy.yml
└── README.md
```

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Create a Telegram Bot

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Send `/newbot` and follow the instructions
3. Copy your bot token

### 3. Configure Environment Variables

Add variables in your Vercel project (**Settings → Environment Variables**):

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Telegram bot token from BotFather |
| `CRON_TARGET_CHATS` | For cron | Comma-separated chat IDs (`123456` or `123456_42` for forum topics) |
| `REDIS_URL` | Recommended | Redis connection for answer/hint storage (24h TTL) |
| `OPENROUTER_API_KEY` | For hints | OpenRouter API key for AI-generated hints |
| `CRON_SECRET` | No | Optional secret for manual cron invocations |

### 4. Deploy to Vercel

#### Option A: Using GitHub Actions (Recommended)

See [GITHUB_SETUP.md](GITHUB_SETUP.md) for detailed setup.

**Quick setup:**
1. Get your Vercel token from [Vercel Account Settings](https://vercel.com/account/tokens)
2. Add `VERCEL_TOKEN` secret to your GitHub repository
3. Run `vercel link` locally to link your project
4. Push to `master` branch — GitHub Actions auto-deploys with `vercel --prod`

#### Option B: Manual Deployment with Vercel CLI

```bash
npm install -g vercel
vercel link
vercel --prod
```

#### Option C: Vercel GitHub Integration

1. Push your code to GitHub
2. Import the repository in Vercel Dashboard
3. Vercel auto-deploys on each push

### 5. Set Webhook URL

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://your-domain.vercel.app/api/webhook"
```

Replace `<YOUR_BOT_TOKEN>` and the domain with your values.

## Commands

| Command | Description |
|---------|-------------|
| `/question` | Random question |
| `/questioneasy` | Easy question |
| `/questionmedium` | Medium question |
| `/questionhard` | Hard question |
| `/menu` | Interactive difficulty chooser |

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `POST /api/webhook` | POST | Telegram update webhook |
| `GET/POST /api/cron/daily-question` | GET, POST | Cron: sends daily question to configured chats |

## Forum Topic Support

In supergroups with forum topics enabled, all bot messages stay inside the topic
where the user issued the command. The `message_thread_id` is extracted from the
incoming update and forwarded to every outgoing message.

For cron jobs, specify the thread ID in `CRON_TARGET_CHATS`:
```
123456,123456_42,99999_9,88888
```
Entries without a thread ID (`123456`) send to the General topic.

## License

ISC
