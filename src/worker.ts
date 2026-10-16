import type { Qualification, Qualifier, Decision } from "./domain.js";
import { decide, requiredFields } from "./domain.js";
import type { Store } from "./store.js";
import type { CrmGateway } from "./kommo.js";
import { KommoError } from "./kommo.js";

export class Worker {
  private running: Promise<void> | null = null;
  constructor(private store: Store, private spec: Qualification, private ai: Qualifier, private crm: CrmGateway) {}
  drain(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.process().finally(() => { this.running = null; });
    return this.running;
  }
  private async process(): Promise<void> {
      for (let job = this.store.claim(); job; job = this.store.claim()) {
        try {
          const conversation = this.store.conversation(job.payload.data.lead_id);
          let decision: Decision;
          const missing = requiredFields(this.spec, conversation.profile).filter(f => !conversation.profile[f.key]).map(f => f.key);
          if (conversation.status === "handoff" || conversation.status === "ready") {
            decision = { reply: "", profile: conversation.profile, missing, status: "handoff", reason: "Conversa já encaminhada ao consultor." };
          } else if (job.payload.data.context === "public_comment") {
            decision = { reply: "Para receber uma cotação, envie uma mensagem privada para nossa equipe. Vamos orientar você por lá!",
              profile: conversation.profile, missing,
              status: "private_chat", reason: "Dados de cotação são coletados em conversa privada pelo canal da Kommo." };
          } else {
            const analysis = await this.ai.analyze(conversation, job.payload.data.message);
            decision = decide(this.spec, conversation.profile, analysis);
          }
          conversation.profile = decision.profile;
          conversation.status = decision.status;
          conversation.messages.push({ role: "user", content: job.payload.data.message });
          if (decision.reply) conversation.messages.push({ role: "assistant", content: decision.reply });
          this.store.saveConversation(conversation);
          const noteId = await this.crm.syncLead(job, decision, conversation.noteId);
          conversation.noteId = noteId;
          this.store.saveConversation(conversation);
          await this.crm.continueBot(job, decision);
          this.store.finish(job.id, decision);
        } catch (error) {
          // A lost CRM/callback response can mean the operation already happened.
          // Require review instead of replaying customer messages automatically.
          const code = error instanceof KommoError ? error.message : error instanceof Error && error.name === "TimeoutError" ? "external_timeout" : "processing_failed";
          this.store.fail(job.id, code);
        }
      }
  }
}
