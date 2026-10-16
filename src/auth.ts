import { createHash } from "node:crypto";
import { jwtVerify } from "jose";
import type { Config } from "./config.js";
import type { Inbound } from "./domain.js";

export function validateCallback(callback: string, account: string): URL {
  const url = new URL(callback);
  if (url.origin !== new URL(account).origin || url.username || url.password || url.search || url.hash || !/^\/api\/v4\/salesbot\/[1-9]\d*\/continue\/[1-9]\d*$/.test(url.pathname)) throw new Error("Invalid Kommo callback");
  return url;
}
export function jobId(inbound: Inbound): string {
  return createHash("sha256").update(inbound.return_url).digest("hex");
}
export async function authenticate(inbound: Inbound, config: Config): Promise<void> {
  validateCallback(inbound.return_url, config.kommoUrl);
  if (!config.kommoClientSecret) throw new Error("Webhook authentication is not configured");
  const { payload } = await jwtVerify(inbound.token, new TextEncoder().encode(config.kommoClientSecret), {
    algorithms: ["HS256"], issuer: config.kommoUrl,
    ...(config.publicUrl ? { audience: new URL(config.publicUrl).origin } : {}),
    requiredClaims: ["exp", "iat", "nbf"], clockTolerance: 5,
  });
  const account = new URL(config.kommoUrl).hostname.split(".")[0];
  if (payload.subdomain !== account || Number(payload.entity_id) !== inbound.data.lead_id || !["lead", "leads", 2, "2"].includes(payload.entity_type as string)) throw new Error("JWT does not match the lead/account");
  const client = payload.client_uuid ?? payload.client_uid;
  if (config.integrationId && client !== config.integrationId) throw new Error("Unexpected integration");
}
