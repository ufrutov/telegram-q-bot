# GitHub Integration Setup Guide

This guide explains how to set up automated deployments to Vercel using GitHub Actions.

## Prerequisites

1. A GitHub repository connected to this project
2. A Vercel account with your project deployed
3. Vercel CLI installed locally (optional for manual deployments)

## GitHub Actions Workflow

The `.github/workflows/deploy.yml` file contains a GitHub Actions workflow that automatically deploys your bot to Vercel production whenever you push to the `master` branch.

## Setup Instructions

### 1. Get Your Vercel Token

1. Go to [Vercel Account Settings](https://vercel.com/account/tokens)
2. Create a new token:
   - Name it something like "GitHub Actions"
   - Copy the token (you won't see it again)

### 2. Configure GitHub Secrets

Add the following secrets to your GitHub repository:

1. Go to your GitHub repository
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add the following secret:
   - **Name**: `VERCEL_TOKEN`
   - **Value**: Your Vercel token from step 1

### 3. Link Your Vercel Project (First Time Setup)

Before the GitHub Action can work, you need to link your local project to Vercel:

```bash
# Install Vercel CLI globally (if not already installed)
npm install -g vercel

# Link to your Vercel project
vercel link

# This will create .vercel directory with project configuration
```

After linking, commit the `.vercel` directory configuration:

```bash
git add .vercel
git commit -m "Add Vercel project configuration"
git push
```

**Note**: The `.vercel/project.json` file contains your project ID and org ID, which are needed for deployments. The `.vercel/README.txt` can be ignored.

### 4. Deploy

Now, whenever you push to the `master` branch, GitHub Actions will automatically:

1. Check out your code
2. Set up Node.js
3. Install Vercel CLI
4. Pull Vercel environment information
5. Build your project
6. Deploy to production using `vercel --prod`

## Manual Deployment

You can still deploy manually from your local machine:

```bash
# Deploy to production
vercel --prod
```

## Monitoring Deployments

- **GitHub Actions**: Check the **Actions** tab in your GitHub repository to see deployment status
- **Vercel Dashboard**: View deployments at [vercel.com/dashboard](https://vercel.com/dashboard)

## Troubleshooting

### Deployment fails with "Project not found"

Make sure you've:
1. Run `vercel link` locally
2. Committed the `.vercel` directory
3. Added the `VERCEL_TOKEN` secret to GitHub

### Environment variables not working

Environment variables must be set in your Vercel project settings:
1. Go to your Vercel Dashboard
2. Select your project
3. **Settings** → **Environment Variables**
4. Add `TELEGRAM_BOT_TOKEN` and any other required variables

### Webhook not working after deployment

After each deployment, you need to set the webhook URL:
1. Get your deployment URL from Vercel (e.g., `https://your-bot.vercel.app`)
2. Set the webhook using this URL format:
   ```
   https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://your-bot.vercel.app/api/webhook
   ```

## Additional Resources

- [Vercel CLI Documentation](https://vercel.com/docs/cli)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Telegram Bot API](https://core.telegram.org/bots/api)
