import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { qualificationSchema, type Qualification } from "./domain.js";

export type Config = {
  mode: "simulation" | "live"; port: number; host: string; database: string;
  kommoUrl: string; kommoAccessToken?: string; kommoClientSecret?: string;
  publicUrl?: string; integrationId?: string; gptKey?: string; model: string;
  adminToken?: string; pipelineId?: number; readyStatusId?: number;
  fieldMap: Record<string, number>; qualification: Qualification;
};
const positive = (value: string | undefined) => value ? z.coerce.number().int().positive().parse(value) : undefined;
export function loadConfig(env = process.env): Config {
  const mode = z.enum(["simulation", "live"]).parse(env.INTEGRATION_MODE || "simulation");
  const kommoUrl = new URL(env.KOMMO_ACCOUNT_URL || "https://suporteexodosaudecom.kommo.com");
  if (kommoUrl.protocol !== "https:" || !/^[a-z0-9-]+\.kommo\.com$/.test(kommoUrl.hostname) || kommoUrl.username || kommoUrl.password || kommoUrl.pathname !== "/") throw new Error("Invalid Kommo account URL");
  const config: Config = {
    mode, port: positive(env.PORT) ?? 3000, host: env.HOST || "127.0.0.1",
    database: env.DATABASE_PATH || (mode === "simulation" ? "data/simulation.sqlite" : "data/ia-comercial.sqlite"), kommoUrl: kommoUrl.origin,
    kommoAccessToken: env.KOMMO_ACCESS_TOKEN, kommoClientSecret: env.KOMMO_CLIENT_SECRET,
    publicUrl: env.APP_PUBLIC_URL, integrationId: env.KOMMO_INTEGRATION_ID,
    gptKey: env.GPT_API_KEY, model: env.GPT_MODEL || "gpt-4.1-mini", adminToken: env.ADMIN_TOKEN,
    pipelineId: positive(env.KOMMO_PIPELINE_ID), readyStatusId: positive(env.KOMMO_READY_STATUS_ID),
    fieldMap: z.record(z.string(), z.number().int().positive()).parse(JSON.parse(env.KOMMO_FIELD_MAP || "{}")),
    qualification: qualificationSchema.parse(JSON.parse(readFileSync(resolve(env.QUALIFICATION_FILE || "qualification.json"), "utf8"))),
  };
  if (mode === "live") {
    const missing = [["GPT_API_KEY", config.gptKey], ["KOMMO_ACCESS_TOKEN", config.kommoAccessToken],
      ["KOMMO_CLIENT_SECRET", config.kommoClientSecret], ["APP_PUBLIC_URL", config.publicUrl], ["ADMIN_TOKEN", config.adminToken]].filter(([,v]) => !v).map(([k]) => k);
    if (missing.length) throw new Error("Missing configuration: " + missing.join(", "));
    if (new URL(config.publicUrl!).protocol !== "https:") throw new Error("APP_PUBLIC_URL requires HTTPS in live mode");
    if (config.readyStatusId && !config.pipelineId) throw new Error("KOMMO_PIPELINE_ID is required with KOMMO_READY_STATUS_ID");
  }
  return config;
}
