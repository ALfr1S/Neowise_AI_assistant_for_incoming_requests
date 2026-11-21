import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { classify } from "./mock-ai.mjs";
import { pathToFileURL } from "node:url";

const html = await readFile(new URL("./index.html", import.meta.url));
const ALLOWED_TOPICS = new Set(["delivery", "pricing", "other"]);
const AI_TIMEOUT_MS = 300;

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw);
}

function validateModelOutput(rawOutput) {
  const parsed = JSON.parse(rawOutput);
  if (!parsed || typeof parsed !== "object") return null;

  const { topic, draft } = parsed;
  if (typeof topic !== "string" || !ALLOWED_TOPICS.has(topic)) return null;
  if (typeof draft !== "string" || draft.trim().length === 0) return null;

  return { topic, draft: draft.trim() };
}

async function handleTriage(request, response) {
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch {
    return json(response, 400, { status: "invalid_input" });
  }

  if (!payload || typeof payload !== "object" || typeof payload.text !== "string" || payload.text.trim().length === 0) {
    return json(response, 400, { status: "invalid_input" });
  }

  const text = payload.text.trim();

  try {
    const rawOutput = await classify(text, { signal: AbortSignal.timeout(AI_TIMEOUT_MS) });
    const validated = validateModelOutput(rawOutput);
    if (!validated) {
      return json(response, 200, { status: "manual_review", topic: null, draft: null });
    }
    return json(response, 200, { status: "ready", ...validated });
  } catch {
    return json(response, 200, { status: "manual_review", topic: null, draft: null });
  }
}

export function createAppServer() {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    if (request.method !== "POST" || request.url !== "/api/triage") {
      return json(response, 404, { status: "not_found" });
    }
    try {
      await handleTriage(request, response);
    } catch {
      json(response, 500, { status: "server_error" });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createAppServer().listen(Number(process.env.PORT || 3000), "127.0.0.1");
}