/** Offline behavior tests: fake PostgREST responses and Telegram methods. */
const assert = require("node:assert/strict");

process.env.SUPABASE_URL = "https://interaction-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-key";
let rows = [];
let failRead = false;
let previews = [];
let requests = [];
global.fetch = async (input, options) => {
  const url = new URL(typeof input === "string" ? input : (input.url ?? String(input)));
  requests.push(url);
  assert.equal(options?.method ?? "GET", "GET", "blocked interactions must not write");
  if (failRead) return new Response(JSON.stringify({ message: "test failure" }), { status: 400 });
  let data;
  if (url.pathname.endsWith("tq-bot-question_sends")) {
    data = [
      {
        answer_payload: { answer: "Answer", answerPreview: previews, packId: "123" },
        hint_payload: { question: "Question", answer: "Answer" },
      },
    ];
  } else if (url.searchParams.get("select") === "id") {
    data = [{ id: "chat-row" }];
  } else {
    assert.equal(url.searchParams.get("chat_id"), "eq.-123");
    data = rows.filter((row) => {
      if (url.searchParams.has("or")) {
        const thread = Number(url.searchParams.get("or").match(/thread_id.eq.(\d+)/)[1]);
        return row.thread_id === null || row.thread_id === thread;
      }
      return row.thread_id === null;
    });
  }
  return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
};

function fakeBot(mediaFailure = false) {
  const calls = [];
  const bot = Object.fromEntries(
    [
      "sendMessage",
      "answerCallbackQuery",
      "editMessageReplyMarkup",
      "deleteMessage",
      "sendMediaGroup",
      "getMe",
    ].map((method) => [
      method,
      async (...args) => {
        calls.push({ method, args });
        if (method === "getMe") return { username: "TestBot" };
        if (method === "sendMediaGroup" && mediaFailure) throw new Error("test media failure");
        return { message_id: 99 };
      },
    ]),
  );
  return { bot, calls };
}
const callback = (data) => ({
  id: "callback",
  data: JSON.stringify(data),
  message: { chat: { id: -123 }, message_id: 42 },
});

async function main() {
  const { getChatInteractionSettings } =
    await import("../dist/src/services/chatInteractionSettings.js");
  const { default: messageHandler } = await import("../dist/api/handlers/messageHandler.js");
  const { default: callbackHandler } = await import("../dist/api/handlers/callbackHandler.js");
  assert.deepEqual(await getChatInteractionSettings(-123), {
    commands_enabled: true,
    answer_buttons_enabled: true,
  });
  rows = [
    { thread_id: null, commands_enabled: false, answer_buttons_enabled: true },
    { thread_id: 7, commands_enabled: true, answer_buttons_enabled: false },
    { thread_id: 8, commands_enabled: false, answer_buttons_enabled: false },
  ];
  assert.deepEqual(await getChatInteractionSettings(-123, 7), {
    commands_enabled: false,
    answer_buttons_enabled: false,
  });
  rows[0].commands_enabled = true;
  assert.deepEqual(
    await getChatInteractionSettings(-123, 7),
    { commands_enabled: true, answer_buttons_enabled: false },
    "dashboard edits must bypass warm cache",
  );
  assert.deepEqual(
    await getChatInteractionSettings(-123, 9),
    { commands_enabled: true, answer_buttons_enabled: true },
    "unrelated topics must not restrict this topic",
  );

  for (const commands of [false, true])
    for (const buttons of [false, true]) {
      rows = [{ thread_id: null, commands_enabled: commands, answer_buttons_enabled: buttons }];
      let { bot, calls } = fakeBot();
      await messageHandler(bot, null, { chat: { id: -123 }, text: "/menu" });
      assert.equal(calls.length, commands ? 1 : 0);
      if (!commands) {
        requests = [];
        for (const text of [
          "/question",
          "/question 123",
          "/questioneasy",
          "/questionmedium",
          "/questionhard",
          "/pack",
          "/pack 123",
          "/stats",
          "/cron on",
          "/cron off",
          "/cron status",
          "/cron help",
          "/menu@TestBot",
        ]) {
          await messageHandler(bot, null, { chat: { id: -123 }, text });
        }
        assert.deepEqual(
          calls.map((c) => c.method),
          ["getMe"],
        );
        assert.equal(requests.length, 13);
      }
      for (const action of [
        { action: "question", complexity: "easy" },
        { action: "packQuestion", questionId: "1" },
        { action: "stats" },
        { action: "cronStatus" },
        { action: "cronToggle", enable: true },
        { action: "pack", packId: "123" },
        { action: "answered", mid: 42 },
      ]) {
        const enabled =
          action.action === "answered"
            ? buttons
            : action.action === "pack"
              ? commands && buttons
              : commands;
        if (enabled) continue;
        ({ bot, calls } = fakeBot());
        requests = [];
        await callbackHandler(bot, null, callback(action));
        assert.deepEqual(
          calls.map((c) => c.method),
          ["answerCallbackQuery"],
        );
        assert.equal(requests.length, 1, "blocked callback must not load or mutate question state");
      }
      for (const media of [false, true])
        for (const mediaFailure of media ? [false, true] : [false]) {
          previews = media ? ["https://example.com/answer.jpg"] : [];
          ({ bot, calls } = fakeBot(mediaFailure));
          await callbackHandler(bot, null, callback({ answerKey: "answer:key:123" }));
          const messages = calls.filter((c) => c.method === "sendMessage");
          assert.equal(messages.length, media && !mediaFailure && !buttons ? 0 : 1);
          if (messages.length) {
            const keyboard = messages[0].args[2].reply_markup?.inline_keyboard.flat() ?? [];
            assert.equal(keyboard.length, buttons ? (commands ? 2 : 1) : 0);
          }
        }
    }
  let { bot, calls } = fakeBot();
  requests = [];
  for (const text of ["/start", "/statsanything", "/menu@OtherBot", "hello"]) {
    await messageHandler(bot, null, { chat: { id: -123 }, text });
  }
  assert.equal(requests.length, 0);
  assert.deepEqual(
    calls.map((c) => c.method),
    ["getMe"],
  );
  await messageHandler(bot, null, { chat: { id: -123 }, text: "/menu@TestBot" });
  assert.equal(calls.at(-1).method, "sendMessage");
  failRead = true;
  assert.deepEqual(await getChatInteractionSettings(-123), {
    commands_enabled: false,
    answer_buttons_enabled: false,
  });
  ({ bot, calls } = fakeBot());
  await messageHandler(bot, null, { chat: { id: -123 }, text: "/menu" });
  assert.equal(calls.length, 0);
  console.log(
    "✓ Chat interaction settings: defaults, inheritance, fresh reads, command guards, stale callbacks, and answer text/media paths",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
