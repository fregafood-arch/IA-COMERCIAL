import { z } from "zod";

export const fieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: z.string().min(1), question: z.string().min(1),
  type: z.enum(["text", "phone", "integer", "ages", "choice", "email"]),
  required: z.boolean(), options: z.array(z.string()).optional(),
  option_labels: z.record(z.string(), z.string()).optional(),
  required_when: z.object({ field: z.string(), operator: z.enum(["in", "lte"]), values: z.array(z.string()).optional(), value: z.number().optional() }).optional(),
});
export const qualificationSchema = z.object({
  company: z.string(), source_url: z.string().url(), source_verified: z.boolean(),
  notice: z.string(), fields: z.array(fieldSchema).min(1).max(30),
}).refine(v => new Set(v.fields.map(f => f.key)).size === v.fields.length, "Duplicate field key");
export type Qualification = z.infer<typeof qualificationSchema>;
export type Profile = Record<string, string>;
export type Message = { role: "user" | "assistant"; content: string };
export type Conversation = { leadId: number; profile: Profile; messages: Message[]; status: string; noteId?: number | null };
export type Analysis = { reply: string; extracted: Record<string, string | null>; handoff: boolean; reason: string; next_field?: string | null };
export type Decision = { reply: string; profile: Profile; missing: string[]; status: "collecting" | "ready" | "handoff" | "private_chat"; reason: string };
export interface Qualifier { analyze(conversation: Conversation, message: string): Promise<Analysis> }

export const inboundSchema = z.object({
  token: z.string().min(1).max(12000),
  return_url: z.string().url().max(2048),
  data: z.object({
    lead_id: z.coerce.number().int().positive().safe(),
    contact_id: z.preprocess(v => v === "" || v === "{{contact.id}}" ? undefined : v,
      z.coerce.number().int().positive().safe().optional()),
    message: z.string().trim().min(1).max(8000),
    channel: z.enum(["instagram", "facebook", "kommo"]).default("kommo"),
    context: z.enum(["private_chat", "public_comment"]).default("private_chat"),
  }),
});
export type Inbound = z.infer<typeof inboundSchema>;
export type Job = { id: string; payload: Inbound; status: string; decision: Decision | null; error: string | null };

function validValue(field: Qualification["fields"][number], value: string): boolean {
  if (value.length < 1 || value.length > 600) return false;
  if (field.type === "phone") return /^\+?[\d\s().-]+$/.test(value) && value.replace(/\D/g, "").length >= 10 && value.replace(/\D/g, "").length <= 15;
  if (field.type === "integer") return /^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 9999;
  if (field.type === "ages") return /^\d{1,3}(?:\s*[,;]\s*\d{1,3})*$/.test(value) && value.split(/[,;]/).every(age => Number(age.trim()) <= 110);
  if (field.type === "choice") return field.options?.includes(value.toLowerCase()) ?? false;
  if (field.type === "email") return z.email().safeParse(value).success;
  return true;
}

export function requiredFields(spec: Qualification, profile: Profile) {
  return spec.fields.filter(field => {
    if (field.required) return true;
    const rule = field.required_when;
    if (!rule || !profile[rule.field]) return false;
    return rule.operator === "in" ? rule.values?.includes(profile[rule.field]!) : Number(profile[rule.field]) <= (rule.value ?? -1);
  });
}

export function decide(spec: Qualification, previous: Profile, analysis: Analysis): Decision {
  const profile: Profile = { ...previous };
  for (const field of spec.fields) {
    const value = analysis.extracted[field.key]?.trim();
    if (value && validValue(field, value)) profile[field.key] = field.type === "choice" ? value.toLowerCase() : value;
  }
  if (profile.contract_type === "pf") delete profile.cnpj_age;
  else if (profile.contract_type) delete profile.profession;
  if (profile.current_plan === "nao") delete profile.current_cost;
  const missing = requiredFields(spec, profile).filter(f => !profile[f.key]).map(f => f.key);
  if (profile.ages && profile.people_count && Number(profile.people_count) <= 10 && profile.ages.split(/[,;]/).length !== Number(profile.people_count)) {
    if (!missing.includes("ages")) missing.push("ages");
  }
  if (analysis.handoff) return { reply: "Vou encaminhar sua conversa para nossa equipe de atendimento.", profile, missing, status: "handoff", reason: analysis.reason };
  if (missing.length === 0) return {
    reply: "Obrigada! Seus dados iniciais estão reunidos. Nossa equipe vai analisar as opções e preparar sua cotação.",
    profile, missing, status: "ready", reason: "Dados de triagem reunidos; cotação depende do consultor.",
  };
  const next = spec.fields.find(f => f.key === missing[0])!;
  const reply = analysis.next_field && missing.includes(analysis.next_field) ? analysis.reply.trim().slice(0, 1500) : next.question;
  return { reply: reply || next.question, profile, missing, status: "collecting", reason: analysis.reason };
}

export function qualificationNote(spec: Qualification, decision: Decision): string {
  return [`Triagem IA — ${spec.company}`, `Situação: ${decision.status}`, "",
    `Perfil: ${["mei", "empresa"].includes(decision.profile.contract_type ?? "") ? "CNPJ/MEI (qualificado conforme o roteiro do site)" : decision.profile.contract_type === "pf" ? "Pessoa física — também atendida pela Êxodo" : "A confirmar"}`,
    ...spec.fields.map(f => `${f.label}: ${decision.profile[f.key] ? displayValue(f, decision.profile[f.key]!) : "Não informado / não se aplica"}`), "",
    `Pendências: ${decision.missing.map(k => spec.fields.find(f => f.key === k)?.label ?? k).join(", ") || "nenhuma no roteiro configurado"}`,
    "Valores, cobertura, carências e elegibilidade devem ser confirmados pelo consultor.",
  ].join("\n");
}

export function displayValue(field: Qualification["fields"][number], value: string): string {
  return field.option_labels?.[value] ?? (field.key === "state" ? value.toUpperCase() : value);
}
