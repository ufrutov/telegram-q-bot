/**
 * Type augmentation for `node-telegram-bot-api`.
 *
 * The community-maintained `@types/node-telegram-bot-api` lags the Telegram
 * Bot API and is missing `message_thread_id` on a few option interfaces.
 * Telegram accepts this field on virtually every send/edit method (it's
 * required for forum-topic support), and the runtime library forwards
 * unknown fields to the API as-is.
 *
 * This file augments only the known gaps so the rest of the codebase can
 * stay cast-free.
 */

import "node-telegram-bot-api";

declare module "node-telegram-bot-api" {
  interface SendMediaGroupOptions {
    message_thread_id?: number;
  }
}
