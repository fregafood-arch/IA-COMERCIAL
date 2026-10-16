import Fastify from "fastify";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Config } from "./config.js";
import { inboundSchema } from "./domain.js";
import { authenticate, jobId } from "./auth.js";
import type { Store } from "./store.js";
import type { Worker } from "./worker.js";
import { botData } from "./kommo.js";

function equalSecret(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function buildApp(config: Config, store: Store, worker: Worker) {
  const app = Fastify({ logger: false, bodyLimit: 65536 });
  const scheduled = new Set<NodeJS.Immediate>();
  let closing = false;
  app.addHook("onClose", async () => {
    closing = true;
    for (const handle of scheduled) clearImmediate(handle);
    scheduled.clear();
    await worker.drain();
  });
  // Sensitive request bodies and headers are never sent to access logs.
  const admin = (authorization: string | undefined) => config.mode === "simulation" || equalSecret(authorization, `Bearer ${config.adminToken}`);
  app.get("/health", async () => ({ status: "ok", mode: config.mode, message_delivery: "kommo_salesbot" }));
  app.get("/", async (req, reply) => {
    if (config.mode === "live") return reply.type("text/plain").send("IA-COMERCIAL: integração Kommo ativa. Consulte /health.");
    return reply.type("text/html; charset=utf-8").send(await readFile(new URL("../public/index.html", import.meta.url), "utf8"));
  });
  app.post("/webhooks/kommo/salesbot", async (req, reply) => {
    if (config.mode !== "live") return reply.code(503).send({ error: "live_webhook_disabled_in_simulation" });
    const parsed = inboundSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_payload" });
    try { await authenticate(parsed.data, config); }
    catch { return reply.code(401).send({ error: "invalid_kommo_authentication" }); }
    const id = jobId(parsed.data);
    const inserted = store.enqueue(id, parsed.data);
    // Durable acceptance only; GPT/CRM work happens after the HTTP 200 (<2s).
    const handle = setImmediate(() => {
      scheduled.delete(handle);
      if (!closing) void worker.drain().catch(() => { console.error("Queue processing failed"); });
    });
    scheduled.add(handle);
    return { accepted: true, duplicate: !inserted, id };
  });
  app.get("/api/status", async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(401).send({ error: "unauthorized" });
    return { mode: config.mode, delivery: "Kommo / Salesbot", qualification: config.qualification,
      jobs: store.listJobs().map(({ id, payload, status, decision, error }) => ({ id, lead_id: payload.data.lead_id, channel: payload.data.channel, status, decision, error })) };
  });
  app.post("/api/simulate", async (req, reply) => {
    if (config.mode !== "simulation") return reply.code(404).send({ error: "not_found" });
    const parsed = z.object({ lead_id: z.number().int().positive().default(1), message: z.string().trim().min(1).max(8000),
      channel: z.enum(["instagram", "facebook"]).default("instagram"), context: z.enum(["private_chat", "public_comment"]).default("private_chat") }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_payload" });
    const continueId = Date.now().toString() + Math.floor(Math.random() * 10000).toString();
    const payload = { token: "simulation-only", data: parsed.data, return_url: `${config.kommoUrl}/api/v4/salesbot/1/continue/${continueId}` };
    const id = jobId(payload);
    store.enqueue(id, payload);
    await worker.drain();
    const job = store.getJob(id);
    return { ...job, bot_data: job?.decision ? botData(job.decision) : null };
  });
  return app;
}
