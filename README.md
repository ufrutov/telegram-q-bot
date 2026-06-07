# telegram-q-bot

Telegram Question Bot ("Что? Где? Когда?") — deployed on Vercel as serverless functions.

## Features

- **Random questions** — `/question` or `/menu` to pick by difficulty (easy/medium/hard)
- **Question packs** — `/pack` to browse and select questions from complete tournament packs
- **AI hints** — OpenRouter generates logical hints without revealing the answer
- **Daily cron** — auto-sends a question to configured chats at 12:00 GMT+3
- **Forum topics** — fully supports Telegram supergroups with forum topics
- **Multi-source** — questions from `gotquestions.online` (primary) and `questions.chgk.info` (fallback)

## Project Structure

```
telegram-q-bot/
├── api/
│   ├── webhook.ts                     # Main webhook entry point (routes updates)
│   ├── handlers/
│   │   ├── messageHandler.ts          # Text command processor (/question, /menu, /pack)
│   │   ├── callbackHandler.ts         # Button press router
│   │   └── callbacks/
│   │       ├── questionCallback.ts          # Menu selection handler
│   │       ├── answerCallback.ts            # Answer reveal handler
│   │       ├── hintCallback.ts              # AI hint generator
│   │       └── packQuestionCallback.ts      # Pack question selection handler
│   └── cron/
│       └── daily-question.ts          # Scheduled question sender
├── src/
│   ├── bot/
│   │   ├── botClient.ts               # Bot & Redis initialization
│   │   └── constants.ts               # Centralized UI messages
│   ├── services/
│   │   ├── questionSender.ts          # Question loading & sending
│   │   ├── packSender.ts              # Pack loading & keyboard generation
│   │   ├── gotQuestionsAuth.ts        # JWT authentication for gotquestions.online
│   │   └── openrouter.ts              # AI hint generation via OpenRouter
│   ├── utils/
│   │   ├── markdown.ts                # Telegram MarkdownV2 escaping
│   │   └── date.ts                    # Russian date formatting
│   ├── lib/
│   │   └── QuestionLoader/            # Question source loaders (factory pattern)
│   │       ├── QuestionLoader.ts
│   │       ├── BaseQuestionLoader.ts
│   │       ├── GotQuestionsOnlineLoader.ts
│   │       └── ChgkInfoQuestionLoader.ts
│   └── types/                         # Shared TypeScript type definitions
│       ├── question.ts
│       ├── telegram.ts
│       ├── telegram-bot-augment.d.ts  # Library type augmentation
│       └── index.ts                   # Barrel re-exports
├── package.json
├── tsconfig.json
├── vercel.json
├── .github/workflows/
│   ├── deploy.yml
│   └── manual-deploy-production.yml
└── README.md
```

Compiled output (`dist/`) is generated at build time and is gitignored.

## Setup

### 1. Install Dependencies

Requires **Node.js ≥ 22.x** (LTS).

```bash
npm install
```

### 2. Local Development

```bash
npm run typecheck   # Type-check without emitting
npm run lint        # Run oxlint
npm run format:check  # Verify formatting (CI-safe)
```

Source is in `src/` and `api/`. The full build (`npm run build`) compiles TypeScript to `dist/`
and rewrites the `@/*` path alias to relative paths for Vercel.

### 3. Create a Telegram Bot

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Send `/newbot` and follow the instructions
3. Copy your bot token

### 4. Configure Environment Variables

Add variables in your Vercel project (**Settings → Environment Variables**):

| Variable                | Required    | Description                                                         |
| ----------------------- | ----------- | ------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`    | Yes         | Telegram bot token from BotFather                                   |
| `GOTQUESTIONS_EMAIL`    | Yes         | Email for gotquestions.online bot account                           |
| `GOTQUESTIONS_PASSWORD` | Yes         | Password for gotquestions.online bot account                        |
| `CRON_TARGET_CHATS`     | For cron    | Comma-separated chat IDs (`123456` or `123456_42` for forum topics) |
| `REDIS_URL`             | Recommended | Redis connection for answer/hint storage and JWT token caching      |
| `OPENROUTER_API_KEY`    | For hints   | OpenRouter API key for AI-generated hints                           |
| `CRON_SECRET`           | No          | Optional secret for manual cron invocations                         |

### 5. Deploy to Vercel

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

### 6. Set Webhook URL

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://your-domain.vercel.app/api/webhook"
```

Replace `<YOUR_BOT_TOKEN>` and the domain with your values.

## Tech Stack

### Runtime

- **Node.js** ≥ 22.x (LTS)
- **TypeScript** 5.6+ — strict mode, ESM (`"type": "module"`), `module: "NodeNext"`
- Path alias: `@/*` → `src/*` (rewritten to relative paths in `dist/` by `tsc-alias`)

### Production dependencies

| Package                 | Version | Purpose                                    |
| ----------------------- | ------- | ------------------------------------------ |
| `node-telegram-bot-api` | 0.66    | Telegram Bot API client                    |
| `redis`                 | 5.10    | Redis client for state and JWT-token cache |
| `dotenv`                | 17.4    | Environment variable loading               |

### Development dependencies

| Package                        | Version | Purpose                                         |
| ------------------------------ | ------- | ----------------------------------------------- |
| `typescript`                   | 5.6     | TypeScript compiler                             |
| `tsc-alias`                    | 1.8     | Rewrites `@/*` imports in compiled output       |
| `oxlint`                       | 1.68    | Rust-based linter (ESLint-compatible)           |
| `oxfmt`                        | 0.53    | Rust-based formatter (Prettier-compatible)      |
| `@vercel/node`                 | 5.0     | Vercel `VercelRequest` / `VercelResponse` types |
| `@types/node`                  | 22.10   | Node.js type definitions                        |
| `@types/node-telegram-bot-api` | 0.64.14 | Bot library type definitions                    |

## Scripts

| Script                 | Description                                                  |
| ---------------------- | ------------------------------------------------------------ |
| `npm run build`        | Compile TypeScript to `dist/` and rewrite `@/*` path aliases |
| `npm run vercel-build` | Alias of `build` (invoked by Vercel during deploy)           |
| `npm run typecheck`    | Type-check without emitting (CI-safe)                        |
| `npm run lint`         | Run oxlint on the project                                    |
| `npm run lint:fix`     | Run oxlint with auto-fix                                     |
| `npm run format`       | Format all source files with oxfmt                           |
| `npm run format:check` | Verify formatting without modifying files (CI-safe)          |
| `npm run validate`     | Run `lint` + `format:check` + `typecheck` (pre-commit ready) |

## Authentication

The bot authenticates with `gotquestions.online` API using JWT tokens via NextAuth:

- **Login flow**: CSRF token → credentials → session cookie → JWT token
- **Session caching**: Redis stores the session cookie (28d TTL) to minimize logins to ~1/month
- **JWT caching**: In-memory cache per invocation + Redis (~59min TTL); auto-refreshes on 401
- **Header format**: `Authorization: JWT <token>` (Bearer prefix is not used by this API)
- **Graceful degradation**: If Redis is unavailable, falls back to in-memory only

## Commands

| Command           | Description                                            |
| ----------------- | ------------------------------------------------------ |
| `/question`       | Random question (any difficulty)                       |
| `/question <id>`  | Load specific question by ID                           |
| `/questioneasy`   | Random easy question                                   |
| `/questionmedium` | Random medium question                                 |
| `/questionhard`   | Random hard question                                   |
| `/menu`           | Interactive difficulty selection menu                  |
| `/pack`           | Display random question pack with interactive keyboard |
| `/pack <id>`      | Display specific pack by ID (e.g., `/pack 6449`)       |

### Pack Command

The `/pack` command displays a complete tournament pack with an inline keyboard for easy question navigation:

**Features:**

- **Pack information**: Title (linked), publication date, average complexity, question count
- **Interactive keyboard**: Question numbers arranged in rows of 6 for easy selection
- **Persistent display**: Pack message remains visible after selecting questions
- **Random or specific**: Use `/pack` for random pack or `/pack 6449` for specific pack

**Example usage:**

```
User: /pack
Bot: [Синхронный турнир «Кубок Владимира Бурды»](https://gotquestions.online/pack/6449/)
     📅 26 августа 2025
     ⚡ Сложность: 2.6
     📊 Вопросов: 36

     Выберите вопрос:
     [1][2][3][4][5][6]
     [7][8][9][10][11][12]
     ...
```

Clicking any number loads that specific question with answer/hint buttons.

## API Routes

| Route                               | Method    | Description                                    |
| ----------------------------------- | --------- | ---------------------------------------------- |
| `POST /api/webhook`                 | POST      | Telegram update webhook                        |
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
