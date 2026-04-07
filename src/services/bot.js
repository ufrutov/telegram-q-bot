const TelegramBot = require("node-telegram-bot-api");
const { createClient } = require("redis");

const token = process.env.TELEGRAM_BOT_TOKEN;
const redisUrl = process.env.REDIS_URL;

function isValidTokenFormat(botToken) {
	if (!botToken || typeof botToken !== "string") {
		return false;
	}
	const tokenPattern = /^\d+:[A-Za-z0-9_-]+$/;
	return tokenPattern.test(botToken);
}

let bot;
if (token && isValidTokenFormat(token)) {
	bot = new TelegramBot(token);
}

let redisClient;
if (redisUrl) {
	redisClient = createClient({
		url: redisUrl,
	});
	redisClient.on("error", (err) => console.error("Redis Client Error", err));
}

async function connectRedis() {
	if (redisClient && !redisClient.isOpen) {
		await redisClient.connect();
	}
}

module.exports = {
	bot,
	redisClient,
	connectRedis,
	token,
};