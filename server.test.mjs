import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppServer } from "./server.mjs";

let server;
let baseUrl;

before(async () => {
  server = createAppServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => {
  server.close();
});

async function postTriage(body, raw = false) {
  const res = await fetch(`${baseUrl}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ? body : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

describe("POST /api/triage", () => {
  it("возвращает ready, тему и черновик для валидной заявки", async () => {
    const res = await postTriage({ text: "Подскажите стоимость доставки?" });
    assert.equal(res.status, 200);
    assert.equal(res.data.status, "ready");
    assert.equal(res.data.topic, "pricing");
    assert.ok(res.data.draft.length > 0);
  });

  it("возвращает 400 invalid_input при пустом, нестроковом вводе или битом JSON", async () => {
    for (const badBody of [{}, { text: "" }, { text: "   " }, { text: 123 }]) {
      const res = await postTriage(badBody);
      assert.equal(res.status, 400);
      assert.deepEqual(res.data, { status: "invalid_input" });
    }
    const brokenJson = await postTriage("{broken", true);
    assert.equal(brokenJson.status, 400);
    assert.deepEqual(brokenJson.data, { status: "invalid_input" });
  });

  it("переводит в manual_review при таймауте, ошибке провайдера, битом JSON, неизвестной теме и пустом черновике", async () => {
    const failureCases = [
      "Заявка [timeout]",
      "Заявка [error]",
      "Заявка [bad-json]",
      "Заявка [bad-topic]",
      "Заявка [empty-draft]",
    ];

    for (const text of failureCases) {
      const res = await postTriage({ text });
      assert.equal(res.status, 200);
      assert.deepEqual(res.data, {
        status: "manual_review",
        topic: null,
        draft: null,
      });
    }
  });
});