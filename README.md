# telegram-q-bot

Telegram Question Bot ("Что? Где? Когда?") — deployed on Vercel as serverless functions.

## Features

- **Random questions** — `/question` or `/menu` to pick by difficulty (easy/medium/hard)
- **Question packs** — `/pack` to browse and select questions from complete tournament packs
- **AI hints** — OpenRouter generates logical hints without revealing the answer
- **Daily send** — per-chat toggle `/cron on|off`, fires one random question at 12:00 local time
- **Statistics** — `/stats` shows load counts, hint rates, and complexity breakdown
- **Forum topics** — fully supports Telegram supergroups with forum topics
- **Multi-source** — questions from `gotquestions.online` (primary) and `questions.chgk.info` (fallback)

## Project Structure

```
telegram-q-bot/
├── api/
│   ├── webhook.ts                     # Main webhook entry point (routes updates)
│   ├── handlers/
│   │   ├── messageHandler.ts          # Text command processor (/question, /menu, /pack, /cron, /stats)
│   │   ├── callbackHandler.ts         # Button press router
│   │   ├── commands/
│   │   │   ├── cronCommand.ts              # /cron on|off|status|help
│   │   │   └── statsCommand.ts             # /stats
│   │   └── callbacks/
│   │       ├── questionCallback.ts          # Menu selection handler
│   │       ├── answerCallback.ts            # Answer reveal handler
│   │       ├── hintCallback.ts              # AI hint generator
│   │       └── packQuestionCallback.ts      # Pack question selection handler
│   └── cron/
│       └── ticker.ts                  # Hourly ticker (replaces daily-question.ts)
├── src/
│   ├── bot/
│   │   ├── botClient.ts               # Bot & Redis initialization
│   │   └── constants.ts               # Centralized UI messages
│   ├── services/
│   │   ├── questionSender.ts          # Question loading & sending (+ DB hooks)
│   │   ├── packSender.ts              # Pack loading & keyboard generation
│   │   ├── gotQuestionsAuth.ts        # JWT authentication for gotquestions.online
│   │   ├── openrouter.ts              # AI hint generation via OpenRouter
│   │   ├── supabase.ts                # Supabase client singleton + TABLES constant
│   │   ├── chatStore.ts               # tq-bot-chats CRUD + cron helpers (setCronEnabled, ticker queries)
│   │   ├── questionSendStore.ts       # tq-bot-question_sends lifecycle (insert + hint update)
│   │   ├── loadFailureStore.ts        # tq-bot-load_failures log
│   │   └── stats.ts                   # /stats aggregator + MarkdownV2 formatter
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
├── supabase/
│   └── migrations/
│       ├── 0000_drop_everything.sql   # Reset helper (drops all tables + functions)
│       └── 0001_init.sql              # Clean init: tq-bot-chats, question_sends, load_failures
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

| Variable                    | Required      | Description                                                      |
| --------------------------- | ------------- | ---------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`        | Yes           | Telegram bot token from BotFather                                |
| `GOTQUESTIONS_EMAIL`        | Yes           | Email for gotquestions.online bot account                        |
| `GOTQUESTIONS_PASSWORD`     | Yes           | Password for gotquestions.online bot account                     |
| `SUPABASE_URL`              | For bot state | Supabase project URL for durable answers, hints, cron, and stats |
| `SUPABASE_SERVICE_ROLE_KEY` | For bot state | Server-side key (never expose to clients)                        |
| `REDIS_URL`                 | Optional      | Redis connection for gotquestions.online session-cookie caching  |
| `OPENROUTER_API_KEY`        | For hints     | OpenRouter API key for AI-generated hints (manual fallback)      |
| `GEMINI_API_KEY`            | For hints     | Gemini API key for AI-generated hints (used when set)            |
| `GEMINI_MODEL`              | Optional      | Gemini model override (default: `gemini-2.5-flash`)              |
| `CRON_SECRET`               | No            | Optional secret for manual cron invocations                      |

> `CRON_TARGET_CHATS` was removed. Per-chat schedules are managed via the
> `/cron` command and stored in Supabase.

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
| `@supabase/supabase-js` | 2.x     | Supabase (Postgres) client for chat state  |
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

The bot authenticates with `gotquestions.online` using Better Auth session cookies:

- **Login flow**: email/password sign-in → session cookie validation
- **Session caching**: Redis stores the Better Auth session cookie until shortly before its expiry (normally about 7 days).
- **In-memory fallback**: A warm serverless instance reuses its session cookie when Redis is unavailable.
- **Recovery**: A 401 clears the cached cookie and performs a fresh login.

## Integration tests

The durable answer and hint state test writes a temporary chat row and removes
it afterward. Every question-send row created by the test is marked
`is_integration_test = true`; cleanup refuses to delete an unmarked row.

```bash
SUPABASE_INTEGRATION_URL=https://YOUR-PROJECT.supabase.co \
SUPABASE_INTEGRATION_SERVICE_ROLE_KEY=... \
npm run test:integration
```

Apply every migration in `supabase/migrations/` to the target project first. For
production-backed CI, GitHub Actions uses the same names as `.env.local`:
repository variable `SUPABASE_URL` and repository secret
`SUPABASE_SERVICE_ROLE_KEY`.

## Commands

| Command           | Description                                                      |
| ----------------- | ---------------------------------------------------------------- |
| `/question`       | Random question (any difficulty)                                 |
| `/question <id>`  | Load specific question by ID                                     |
| `/questioneasy`   | Random easy question                                             |
| `/questionmedium` | Random medium question                                           |
| `/questionhard`   | Random hard question                                             |
| `/menu`           | Interactive difficulty selection menu                            |
| `/pack`           | Display random question pack with interactive keyboard           |
| `/pack <id>`      | Display specific pack by ID (e.g., `/pack 6449`)                 |
| `/cron on`        | Enable the daily 12:00 question (chat's timezone)                |
| `/cron off`       | Disable the daily question                                       |
| `/cron status`    | Show current state and last send date                            |
| `/stats`          | Lifetime counts per complexity: questions loaded and hints asked |

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

| Route                       | Method    | Description                                                              |
| --------------------------- | --------- | ------------------------------------------------------------------------ |
| `POST /api/webhook`         | POST      | Telegram update webhook                                                  |
| `GET/POST /api/cron/ticker` | GET, POST | Daily ticker (2x/day) — sends a question per chat whose cron matches now |

## Forum Topic Support

In supergroups with forum topics enabled, all bot messages stay inside the topic
where the user issued the command. The `message_thread_id` is extracted from the
incoming update and forwarded to every outgoing message.

Each forum topic is a separate row in `tq-bot-chats` (the
`unique (chat_id, thread_id)` constraint), so `/cron` toggles the daily
question independently for each topic.

## Per-chat interaction settings

Apply `supabase/migrations/0004_chat_interaction_settings.sql` manually in the
Supabase SQL editor before deploying this version. Both columns default to `TRUE`,
including on existing rows.

| Column                   | Behavior when `FALSE`                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| `commands_enabled`       | Silently ignore commands and block menu, pack-navigation, statistics, and cron-setting callbacks. |
| `answer_buttons_enabled` | Hide and disable “Play pack” and “Count answer” buttons on answer messages.                       |

`/start` remains unimplemented and ignored. Answer and Hint buttons remain
available, and scheduled questions still depend on `is_active` and `cron_enabled`.
“Play pack” requires both flags to be enabled; “Count answer” requires only
`answer_buttons_enabled`. This setting controls the existing “Count answer”
button; Statistics is a separate menu action.

A row with `thread_id IS NULL` applies to the entire chat/group, including all
forum topics. A topic row can further restrict interactions; either row being
`FALSE` disables that capability. Missing rows default to enabled. Settings are
read fresh for each relevant update, so dashboard edits affect subsequent requests
without a restart. Database lookup failures suppress restricted interactions.

For an existing chat, disable commands across the whole group:

```sql
UPDATE "tq-bot-chats"
SET commands_enabled = FALSE, updated_at = now()
WHERE chat_id = -1001234567890 AND thread_id IS NULL;
```

If the group only has topic rows, create its group-level settings row:

```sql
INSERT INTO "tq-bot-chats" (chat_id, thread_id, commands_enabled)
VALUES (-1001234567890, NULL, FALSE)
ON CONFLICT (chat_id, thread_id)
DO UPDATE SET commands_enabled = EXCLUDED.commands_enabled, updated_at = now();
```

Set `answer_buttons_enabled = FALSE` on the relevant group or topic row to hide
answer actions. Existing message keyboards are not proactively edited, but their
restricted callbacks are acknowledged silently and perform no action. Telegram's
slash-command suggestions are unchanged; `/menu` and its callbacks are guarded
inside the bot.

Run offline interaction tests with `npm run test:interactions`.

## Database Setup

The bot uses [Supabase](https://supabase.com) (Postgres) for chat-related
state. Migrations are applied **manually**; the source of truth is committed
to the repo.

1. Create a Supabase project (or use an existing one).
2. Add these env vars to Vercel:
   - `SUPABASE_URL` — project URL
   - `SUPABASE_SERVICE_ROLE_KEY` — server-side key (never expose to clients)
3. Open the Supabase SQL editor and paste the contents of
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).
   Run it.

The file is idempotent (`create table if not exists`, `create or replace
function`), so re-running is safe.

If you need to reset before re-applying, run
[`supabase/migrations/0000_drop_everything.sql`](supabase/migrations/0000_drop_everything.sql)
first.

All tables are prefixed with `tq-bot-` so multiple projects can share one
database without name collisions. The schema is:

- `tq-bot-chats` — one row per chat (or chat+thread pair); holds `cron_enabled`,
  `cron_time`, `cron_last_sent_at`
- `tq-bot-question_sends` — one row per question successfully sent (mutated on hint)
- `tq-bot-load_failures` — append-only log of failed question loads

The bot degrades gracefully if Supabase is unreachable: every DB call is
wrapped in a try/catch that logs a warning and continues. The user always
sees the same Telegram reply they would without the integration.

## License

ISC

## Web dashboard

The `/` dashboard lists registered chats/topics, schedules and question-send history.
Supabase email/password authentication is required. Any authenticated user in the
configured project can manage the daily-question, command and answer-button flags
or delete a chat row and its history. No new tables or RLS policies are needed.

Run `npm run dev` and open http://localhost:5173 after configuring `.env.local`.
Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the project's public
credentials, and keep `SUPABASE_SERVICE_ROLE_KEY` server-side. Create dashboard
users through Supabase Auth; every authenticated user has management access.

The Send question page previews a random question or a question by ID, then sends
it to up to 10 selected chats/topics. Sending requires `TELEGRAM_BOT_TOKEN` and
uses the existing question loader and Telegram delivery flow. Local sends use
real configured credentials. Restart the local server after changing `.env.local`.

Select Message on the same page to compose an announcement in Telegram Markdown:
`*bold*`, `_italic_`, inline code and `[text](https://example.com)` links. Preview
the message before sending; editing the text requires a new preview. Messages
are limited to 4096 characters and are delivered without question buttons or
question-history entries. Per-chat results report invalid Markdown or delivery
failures. Duplicate protection uses Redis when configured, or the current server
process otherwise. Check Telegram before starting a new send after an unconfirmed
result.

The sidebar displays the package version bundled at build time.

Run `npm run build:web` followed by `npm run preview:dashboard` to check built
frontend assets locally. Deployment builds the frontend before packaging Vercel
output. Set the GitHub Actions variables `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` for these builds (`SUPABASE_URL` and `SUPABASE_ANON_KEY`
are also accepted as fallbacks), alongside the existing server environment
variables in Vercel.

## Dependency security

`package.json` pins minimum patched tooling versions and uses npm overrides for
transitive dependencies whose parents still require vulnerable releases:

- The Telegram client keeps its existing API. Its request transport uses
  `@cypress/request` 4, including the unused legacy `request` peer installed by
  `request-promise-core`. Patched `qs` and `form-data` are enforced explicitly.
- Vercel tooling uses the patched file tracer, Undici, route matcher and Ajv.
- The formatter uses the patched Tinypool worker implementation.

Use Node.js 22.12 or newer for the updated tooling. The deployment workflows
already use Node.js 22.

Review these overrides when updating the parent packages; remove them once the
parents require patched versions themselves. Run `npm audit`, `npm run validate`,
`npm run test:interactions` and `npm run test:transport` after dependency changes.
The transport test runs a local fake Telegram API and verifies text, callbacks,
media uploads and error responses without sending real Telegram messages.
