/** Offline hint configuration and provider-routing regressions. */
const assert = require("node:assert/strict");
process.env.SUPABASE_URL = "https://hint-settings-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
process.env.GEMINI_API_KEY = "test-gemini-secret";
process.env.OPENROUTER_API_KEY = "test-openrouter-secret";
process.env.GEMINI_MODEL = "gemini-3.5-flash";
process.env.HINT_PROVIDER = "gemini";
process.env.REDIS_URL = process.argv.includes("--without-redis") ? "" : "redis://127.0.0.1:1";
process.env.TELEGRAM_BOT_TOKEN = "";
const chatId = "550e8400-e29b-41d4-a716-446655440000";
const unknownId = "650e8400-e29b-41d4-a716-446655440000";
let rows = [
  { thread_id: null, hint_provider: null, hint_model: null },
  { thread_id: 7, hint_provider: null, hint_model: null },
];
let failModels = false,
  failProvider = false,
  failDatabase = false,
  failRedis = false;
let writes = 0;
const generations = [];
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
global.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === "string" ? input : (input.url ?? String(input)));
  if (url.hostname === "generativelanguage.googleapis.com") {
    assert.equal(options.headers["x-goog-api-key"], process.env.GEMINI_API_KEY);
    if (options.method === "POST") {
      generations.push({
        provider: "gemini",
        model: url.pathname.split("/").at(-1).split(":")[0],
        body: JSON.parse(options.body),
      });
      return failProvider
        ? json({ error: process.env.GEMINI_API_KEY }, 403)
        : json({
            candidates: [
              {
                content: {
                  parts: [
                    { text: "Private reasoning must stay private", thought: true },
                    { text: "Ищите связь с античной историей." },
                  ],
                },
              },
            ],
          });
    }
    if (failModels) return json({ error: "test failure" }, 503);
    return json({
      models: [
        {
          name: "models/gemini-3.5-flash",
          displayName: "Flash",
          supportedGenerationMethods: ["generateContent"],
        },
        {
          name: "models/gemini-3.5-pro",
          displayName: "Pro",
          supportedGenerationMethods: ["generateContent"],
        },
        { name: "models/gemini-3.5-flash-image", supportedGenerationMethods: ["generateContent"] },
        { name: "models/embedding-test", supportedGenerationMethods: ["embedContent"] },
      ],
    });
  }
  if (url.hostname === "openrouter.ai") {
    assert.equal(options.headers.Authorization, `Bearer ${process.env.OPENROUTER_API_KEY}`);
    if (options.method === "POST") {
      const body = JSON.parse(options.body);
      generations.push({ provider: "openrouter", model: body.model, body });
      return json({ choices: [{ message: { content: "Вспомните античную историю." } }] });
    }
    return json({
      data: [
        {
          id: "test/vision",
          name: "Vision",
          architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
        },
        {
          id: "test/text",
          name: "Text only",
          architecture: { input_modalities: ["text"], output_modalities: ["text"] },
        },
      ],
    });
  }
  assert.equal(url.hostname, "hint-settings-test.invalid", "unexpected external request");
  if (url.pathname === "/auth/v1/user") return json({ id: chatId, email: "tester@example.com" });
  assert.ok(url.pathname.endsWith("tq-bot-chats"), "settings must not use new tables");
  if (failDatabase) return json({ message: "test database error" }, 500);
  if (url.searchParams.get("id") === `eq.${unknownId}`) return json([]);
  if (options.method === "PATCH") {
    writes++;
    Object.assign(rows[1], JSON.parse(options.body));
    return json([{ id: chatId }]);
  }
  if (url.searchParams.get("select") === "chat_id,thread_id")
    return json([{ chat_id: -123, thread_id: 7 }]);
  return json(
    rows.filter((row) =>
      url.searchParams.has("or")
        ? row.thread_id === null || row.thread_id === 7
        : row.thread_id === null,
    ),
  );
};
async function main() {
  const { getRedisClient } = await import("../dist/src/bot/botClient.js");
  const redis = getRedisClient();
  if (!redis) {
    const { getHintSettings, saveGlobalHintConfig } =
      await import("../dist/src/services/hintSettings.js");
    assert.equal((await getHintSettings()).globalStorage, false);
    assert.equal((await getHintSettings(-123, 7)).effective.source, "environment");
    await assert.rejects(saveGlobalHintConfig(null, false), /Configure REDIS_URL/);
    console.log("Hint configuration works without Redis; global saves require it.");
    return;
  }
  const memory = new Map();
  redis.connect = async () => redis;
  redis.get = async (key) => {
    if (failRedis) throw Error("Redis unavailable");
    return memory.get(key) ?? null;
  };
  redis.set = async (key, value) => {
    if (failRedis) throw Error("Redis unavailable");
    writes++;
    memory.set(key, value);
    return "OK";
  };
  const { getHintSettings, saveGlobalHintConfig, listHintModels, validateHintConfig } =
    await import("../dist/src/services/hintSettings.js");
  const { generateHint } = await import("../dist/src/services/hintGenerator.js");
  assert.deepEqual((await getHintSettings(-123, 7)).effective, {
    provider: "gemini",
    model: "gemini-3.5-flash",
    source: "environment",
  });
  failModels = true;
  await assert.rejects(listHintModels("gemini"), /Could not load Gemini models/);
  failModels = false;
  assert.deepEqual(
    (await listHintModels("gemini")).map((m) => m.id),
    ["gemini-3.5-flash", "gemini-3.5-pro"],
  );
  assert.deepEqual(
    (await listHintModels("openrouter")).map((m) => m.id),
    ["openrouter/auto", "test/vision"],
  );
  await assert.rejects(
    validateHintConfig({ provider: "openrouter", model: "test/text" }),
    /supported model/,
  );
  await saveGlobalHintConfig({ provider: "gemini", model: "gemini-3.5-pro" }, false);
  assert.equal((await getHintSettings(-123, 7)).effective.source, "bot");
  rows[0].hint_provider = "openrouter";
  rows[0].hint_model = "test/vision";
  assert.equal((await getHintSettings(-123, 7)).effective.source, "main-chat");
  rows[1].hint_provider = "gemini";
  rows[1].hint_model = "gemini-3.5-flash";
  assert.equal((await getHintSettings(-123, 7)).effective.source, "chat");
  assert.equal(
    (await getHintSettings(-123, 7, true)).effective.source,
    "main-chat",
    "preview inheritance must ignore the unsaved local override",
  );
  assert.equal((await getHintSettings(-123, undefined, true)).effective.source, "bot");
  assert.equal((await getHintSettings(undefined, undefined, true)).effective.source, "environment");
  assert.equal(
    await generateHint("Question", "Answer", undefined, [], undefined, -123, 7),
    "Ищите связь с античной историей.",
  );
  assert.equal(generations.at(-1).provider, "gemini");
  assert.equal(generations.at(-1).model, "gemini-3.5-flash");
  await saveGlobalHintConfig({ provider: "openrouter", model: "test/vision" }, true);
  assert.equal((await getHintSettings(-123, 7)).effective.source, "bot");
  await generateHint("Question", "Answer", undefined, [], undefined, -123, 7);
  assert.equal(generations.at(-1).model, "test/vision");
  await saveGlobalHintConfig({ provider: "openrouter", model: "test/vision" }, false);
  assert.equal(
    (await getHintSettings(-123, 7)).effective.source,
    "chat",
    "global override must preserve local choices",
  );
  failDatabase = true;
  await assert.rejects(getHintSettings(-123, 7), /Could not load chat hint settings/);
  failDatabase = false;
  const { default: dashboard } = await import("../dist/api/dashboard.js");
  async function request(resource, method = "GET", body, extra = {}, authorized = true) {
    const response = {
      code: 0,
      setHeader() {},
      status(code) {
        this.code = code;
        return this;
      },
      json(value) {
        this.body = value;
        return this;
      },
    };
    await dashboard(
      {
        method,
        query: { resource, ...extra },
        headers: authorized ? { authorization: "Bearer test" } : {},
        body,
      },
      response,
    );
    assert.ok(!JSON.stringify(response.body).includes("test-gemini-secret"));
    assert.ok(!JSON.stringify(response.body).includes("test-openrouter-secret"));
    return response;
  }
  assert.equal((await request("hint-settings", "GET", undefined, {}, false)).code, 401);
  assert.equal((await request("hint-settings", "DELETE")).code, 405);
  assert.equal((await request("hint-settings", "GET", undefined, { chatId: unknownId })).code, 404);
  assert.equal(
    (await request("hint-models", "GET", undefined, { provider: "openrouter" })).body.models.length,
    2,
  );
  for (const config of [
    { provider: "other", model: "test" },
    { provider: "gemini", model: "../../bad" },
    { provider: "gemini", model: "gemini-unavailable" },
    { provider: "openrouter", model: "test/text" },
    { provider: "gemini" },
  ]) {
    assert.equal((await request("hint-settings", "PATCH", { config })).code, 400);
  }
  assert.equal(
    (await request("hint-settings", "PATCH", { config: null, overrideAll: true }, { chatId })).code,
    400,
  );
  const saved = await request(
    "hint-settings",
    "PATCH",
    { config: { provider: "openrouter", model: "test/vision" } },
    { chatId },
  );
  assert.equal(saved.code, 200);
  assert.equal(saved.body.override.provider, "openrouter");
  const before = writes;
  const tested = await request(
    "hint-test",
    "POST",
    {
      config: { provider: "gemini", model: "gemini-3.5-pro" },
      question: "Question",
      answer: "Answer",
    },
    { chatId },
  );
  assert.equal(tested.code, 200);
  assert.equal(tested.body.model, "gemini-3.5-pro");
  assert.equal(writes, before, "test must not save settings or send messages");
  failProvider = true;
  assert.equal(
    (
      await request("hint-test", "POST", {
        config: { provider: "gemini", model: "gemini-3.5-pro" },
        question: "Question",
        answer: "Answer",
      })
    ).code,
    502,
  );
  failProvider = false;
  assert.equal(
    (await request("hint-settings", "PATCH", { config: null }, { chatId })).body.override,
    null,
  );
  assert.equal(
    (await request("hint-settings", "PATCH", { config: null, overrideAll: false })).code,
    200,
  );
  assert.equal((await getHintSettings(-123, 7)).effective.source, "main-chat");
  failRedis = true;
  assert.equal((await request("hint-settings", "PATCH", { config: null })).code, 503);
  const child = require("node:child_process").execFileSync(
    process.execPath,
    [__filename, "--without-redis"],
    { encoding: "utf8" },
  );
  assert.match(child, /works without Redis/);
  console.log(
    "✓ Hint model settings: provider catalog filtering, fresh inheritance, global override and restore, routing, authenticated saves/previews, error handling and no new tables or Telegram messages",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
