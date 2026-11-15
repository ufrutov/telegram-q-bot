/** Exercise the actual Telegram HTTP client against a local fake API.
 * Covers the request/form-data security overrides without Telegram credentials.
 */
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { once } = require("node:events");
process.env.NTBA_FIX_350 = "1";
const TelegramBot = require("node-telegram-bot-api");

async function main() {
  const calls = [];
  const serverErrors = [];
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  const server = createServer((req, res) => {
    (async () => {
      assert.equal(req.method, "POST");
      const url = new URL(req.url, "http://localhost");
      assert.match(url.pathname, /^\/bot123:test\/[A-Za-z]+$/);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const fields = {
        ...Object.fromEntries(url.searchParams),
        ...Object.fromEntries(
          await new Response(Buffer.concat(chunks), {
            headers: { "Content-Type": req.headers["content-type"] },
          }).formData(),
        ),
      };
      const method = url.pathname.split("/").at(-1);
      calls.push({ method, fields });
      res.setHeader("Content-Type", "application/json");
      if (fields.text === "invalid-markdown") {
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            ok: false,
            error_code: 400,
            description: "Bad Request: invalid Markdown",
          }),
        );
        return;
      }
      const result =
        method === "getMe"
          ? { id: 123, is_bot: true, first_name: "Test", username: "TestBot" }
          : method === "sendMediaGroup"
            ? [{ message_id: 41 }, { message_id: 42 }]
            : method === "sendMessage" || method === "sendPhoto"
              ? { message_id: 43 }
              : true;
      res.end(JSON.stringify({ ok: true, result }));
    })().catch((error) => {
      serverErrors.push(error);
      res.writeHead(500);
      res.end("Fake API failed");
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const bot = new TelegramBot("123:test", {
      baseApiUrl: `http://127.0.0.1:${server.address().port}`,
      polling: false,
      request: { timeout: 3000 },
    });
    assert.equal((await bot.getMe()).username, "TestBot");
    const message = "*Announcement*\nПривет, команда! [Details](https://example.com?a=1&b=2)";
    assert.equal(
      (await bot.sendMessage(-123, message, { parse_mode: "Markdown", message_thread_id: 7 }))
        .message_id,
      43,
    );
    assert.equal(calls.at(-1).fields.text, message);
    assert.equal(calls.at(-1).fields.parse_mode, "Markdown");
    assert.equal(calls.at(-1).fields.message_thread_id, "7");

    await bot.sendPhoto(
      -123,
      png,
      { message_thread_id: 7 },
      { filename: "question.png", contentType: "image/png" },
    );
    const photo = calls.at(-1).fields.photo;
    assert.equal(photo.name, "question.png");
    assert.equal(photo.type, "image/png");
    assert.deepEqual(Buffer.from(await photo.arrayBuffer()), png);

    await bot.sendMediaGroup(
      -123,
      [
        { type: "photo", media: png, caption: "Question", parse_mode: "MarkdownV2" },
        { type: "photo", media: "https://example.com/question.png" },
      ],
      { message_thread_id: 7 },
    );
    const group = calls.at(-1).fields;
    const media = JSON.parse(group.media);
    assert.equal(media[0].caption, "Question");
    assert.equal(media[0].parse_mode, "MarkdownV2");
    assert.equal(media[1].media, "https://example.com/question.png");
    assert.equal(group.message_thread_id, "7");
    const attachment = group[media[0].media.replace("attach://", "")];
    assert.deepEqual(Buffer.from(await attachment.arrayBuffer()), png);

    await bot.answerCallbackQuery("callback-1", { text: "Saved" });
    assert.equal(calls.at(-1).fields.callback_query_id, "callback-1");
    await bot.editMessageReplyMarkup(
      { inline_keyboard: [[{ text: "Answer", callback_data: "answer" }]] },
      { chat_id: -123, message_id: 43 },
    );
    assert.equal(
      JSON.parse(calls.at(-1).fields.reply_markup).inline_keyboard[0][0].callback_data,
      "answer",
    );
    await bot.deleteMessage(-123, 43);
    assert.equal(calls.at(-1).fields.message_id, "43");

    await assert.rejects(bot.sendMessage(-123, "invalid-markdown"), (error) => {
      assert.equal(error.code, "ETELEGRAM");
      assert.equal(error.response.body.error_code, 400);
      assert.match(error.response.body.description, /invalid Markdown/);
      return true;
    });
    assert.deepEqual(serverErrors, []);
    console.log(
      "✓ Telegram transport: Unicode Markdown, topic routing, photo/media uploads, callbacks, edits, deletion and API errors (local fake API only)",
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
