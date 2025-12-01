const TelegramBot = require('node-telegram-bot-api');

// Get the bot token from environment variables
const token = process.env.TELEGRAM_BOT_TOKEN;

// Create a bot instance (without polling since we're using webhooks)
let bot;
if (token) {
  bot = new TelegramBot(token);
}

/**
 * Vercel Serverless Function for Telegram Bot Webhook
 * 
 * This API route handles incoming webhook requests from Telegram.
 * Configure your Telegram bot webhook URL to point to:
 * https://your-vercel-domain.vercel.app/api/webhook
 * 
 * @param {import('http').IncomingMessage} req - The HTTP request object
 * @param {import('http').ServerResponse} res - The HTTP response object
 */
module.exports = async (req, res) => {
  // Only accept POST requests from Telegram
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check if bot token is configured
  if (!token || !bot) {
    console.error('TELEGRAM_BOT_TOKEN is not configured');
    return res.status(500).json({ error: 'Bot not configured' });
  }

  try {
    const update = req.body;

    // Process the incoming update from Telegram
    if (update && update.message) {
      const chatId = update.message.chat.id;
      const messageText = update.message.text;

      // Echo the received message back (basic example)
      if (messageText) {
        await bot.sendMessage(chatId, `You said: ${messageText}`);
      }
    }

    // Respond with 200 OK to acknowledge receipt
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
