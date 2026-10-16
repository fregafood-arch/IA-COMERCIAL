import type { Config } from "./config.js";
import type { Decision, Job } from "./domain.js";
import { qualificationNote, displayValue } from "./domain.js";
import { validateCallback } from "./auth.js";
import type { Store } from "./store.js";

export interface CrmGateway {
  syncLead(job: Job, decision: Decision, noteId?: number | null): Promise<number | null>;
  continueBot(job: Job, decision: Decision): Promise<void>;
}
export class KommoError extends Error {
  constructor(public readonly operation: string, public readonly status: number) {
    super(`kommo_${operation}_${status}`);
  }
}
export function botData(decision: Decision) {
  return { reply: decision.reply, status: decision.status, ready: decision.status === "ready" ? "yes" : "no",
    send_reply: decision.reply ? "yes" : "no", missing_fields: decision.missing.join(", "),
    commercial_qualified: ["mei", "empresa"].includes(decision.profile.contract_type ?? "") ? "yes" : "no",
    contract_type: decision.profile.contract_type ?? "" };
}
export class KommoGateway implements CrmGateway {
  constructor(private config: Config, private fetcher: typeof fetch = fetch) {}
  private async request(path: string, method: string, body: unknown): Promise<any> {
    const response = await this.fetcher(this.config.kommoUrl + path, {
      method, headers: { Authorization: `Bearer ${this.config.kommoAccessToken}`, "Content-Type": "application/json", Accept: "application/hal+json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(20000), redirect: "error",
    });
    if (!response.ok) throw new KommoError(path.includes("continue") ? "continue" : "crm", response.status);
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  async syncLead(job: Job, decision: Decision, noteId?: number | null): Promise<number | null> {
    const fields = Object.entries(decision.profile).flatMap(([key, value]) => {
      const fieldId = this.config.fieldMap[key];
      const field = this.config.qualification.fields.find(f => f.key === key);
      return fieldId ? [{ field_id: fieldId, values: [{ value: field ? displayValue(field, value) : value }] }] : [];
    });
    const lead: Record<string, unknown> = { id: job.payload.data.lead_id };
    if (fields.length) lead.custom_fields_values = fields;
    if (decision.status === "ready" && this.config.readyStatusId && this.config.pipelineId) {
      lead.pipeline_id = this.config.pipelineId; lead.status_id = this.config.readyStatusId;
    }
    if (Object.keys(lead).length > 1) await this.request("/api/v4/leads", "PATCH", [lead]);
    if (!["ready", "handoff"].includes(decision.status)) return noteId ?? null;
    const note = { note_type: "common", params: { text: qualificationNote(this.config.qualification, decision) } };
    if (noteId) {
      await this.request("/api/v4/leads/notes", "PATCH", [{ id: noteId, ...note }]);
      return noteId;
    }
    const created = await this.request("/api/v4/leads/notes", "POST", [{ entity_id: job.payload.data.lead_id, ...note }]);
    const id = created?._embedded?.notes?.[0]?.id;
    if (typeof id !== "number") throw new Error("kommo_note_response_invalid");
    return id;
  }
  async continueBot(job: Job, decision: Decision): Promise<void> {
    const callback = validateCallback(job.payload.return_url, this.config.kommoUrl);
    // The native Salesbot message block sends {{json.reply}} on its existing channel.
    // No Meta/Instagram/Facebook send API is used here.
    await this.request(callback.pathname, "POST", { data: botData(decision) });
  }
}
export class SimulationGateway implements CrmGateway {
  constructor(private store: Store) {}
  async syncLead(_job: Job, _decision: Decision, noteId?: number | null): Promise<number | null> { return noteId ?? null; }
  async continueBot(job: Job, decision: Decision): Promise<void> { this.store.simulatedReply(job.id, botData(decision)); }
}
