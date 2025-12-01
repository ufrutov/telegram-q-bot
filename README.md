# telegram-q-bot

Telegram Question Bot - A Telegram bot deployed on Vercel using serverless functions.

## Project Structure

```
telegram-q-bot/
├── api/
│   └── webhook.js    # Vercel serverless function for Telegram webhook
├── package.json
├── .gitignore
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

Add your bot token as an environment variable in Vercel:

1. Go to your [Vercel Dashboard](https://vercel.com)
2. Select your project
3. Go to **Settings** → **Environment Variables**
4. Add a new variable:
   - Name: `TELEGRAM_BOT_TOKEN`
   - Value: Your bot token from BotFather

### 4. Deploy to Vercel

#### Option A: Using GitHub Actions (Recommended)

This project includes automated deployment via GitHub Actions. See [GITHUB_SETUP.md](GITHUB_SETUP.md) for detailed setup instructions.

**Quick setup:**
1. Get your Vercel token from [Vercel Account Settings](https://vercel.com/account/tokens)
2. Add `VERCEL_TOKEN` secret to your GitHub repository
3. Run `vercel link` locally to link your project
4. Push to `master` branch - GitHub Actions will automatically deploy using `vercel --prod`

#### Option B: Manual Deployment with Vercel CLI

```bash
# Install Vercel CLI globally
npm install -g vercel

# Link to your Vercel project (first time)
vercel link

# Deploy to production
vercel --prod
```

#### Option C: Using Vercel GitHub Integration

1. Push your code to GitHub
2. Import your repository in Vercel Dashboard
3. Vercel will automatically deploy on each push

### 5. Set Webhook URL

After deploying, set your Telegram bot webhook URL:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://your-vercel-domain.vercel.app/api/webhook"
```

Replace:
- `<YOUR_BOT_TOKEN>` with your actual bot token
- `your-vercel-domain.vercel.app` with your Vercel deployment URL

## API Route

The webhook endpoint is available at:
```
POST /api/webhook
```

This endpoint receives updates from Telegram and processes incoming messages.

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `TELEGRAM_BOT_TOKEN` | Your Telegram bot token from BotFather | Yes |

## License

ISC
