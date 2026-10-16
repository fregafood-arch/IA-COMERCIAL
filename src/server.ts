import OpenAI from "openai";
import { loadConfig } from "./config.js";
import { Store } from "./store.js";
import { OpenAiQualifier, SimulationQualifier } from "./ai.js";
import { KommoGateway, SimulationGateway } from "./kommo.js";
import { Worker } from "./worker.js";
import { buildApp } from "./app.js";

const config = loadConfig();
const store = new Store(config.database, config.mode);
const qualifier = config.mode === "live" ? new OpenAiQualifier(config.qualification, new OpenAI({ apiKey: config.gptKey, maxRetries: 2, timeout: 30000 }), config.model) : new SimulationQualifier(config.qualification);
const gateway = config.mode === "live" ? new KommoGateway(config) : new SimulationGateway(store);
const worker = new Worker(store, config.qualification, qualifier, gateway);
const app = buildApp(config, store, worker);
await app.listen({ host: config.host, port: config.port });
console.log(`IA-COMERCIAL running: mode=${config.mode}, port=${config.port}, delivery=kommo_salesbot`);
const timer = setInterval(() => { void worker.drain(); }, 500);
timer.unref();
let stopping = false;
async function stop() { if (stopping) return; stopping = true; clearInterval(timer); await app.close(); await worker.drain(); store.close(); }
process.on("SIGTERM", () => { void stop(); });
process.on("SIGINT", () => { void stop(); });
