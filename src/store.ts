import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Conversation, Decision, Inbound, Job } from "./domain.js";

type Row = { id: string; payload: string; status: string; decision: string | null; error: string | null };
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string, mode: "simulation" | "live" | "test" = "test") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS application_mode (id INTEGER PRIMARY KEY CHECK(id=1), mode TEXT NOT NULL);`);
    const recorded = this.db.prepare("SELECT mode FROM application_mode WHERE id=1").get() as { mode: string } | undefined;
    if (recorded && recorded.mode !== mode) {
      this.db.close();
      throw new Error("Database belongs to another integration mode; use a separate DATABASE_PATH");
    }
    this.db.prepare("INSERT OR IGNORE INTO application_mode(id,mode) VALUES(1,?)").run(mode);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
        decision TEXT, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS conversations (lead_id INTEGER PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS simulation_replies (id INTEGER PRIMARY KEY, job_id TEXT NOT NULL, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, created_at);
      UPDATE jobs SET status='needs_review', error='interrupted_processing' WHERE status='processing';`);
  }
  enqueue(id: string, payload: Inbound): boolean {
    // Authentication tokens are verified at ingress and never written to disk.
    const safe = { ...payload, token: "verified-at-ingress" };
    const now = Date.now();
    return this.db.prepare("INSERT OR IGNORE INTO jobs(id,payload,created_at,updated_at) VALUES(?,?,?,?)")
      .run(id, JSON.stringify(safe), now, now).changes === 1;
  }
  claim(): Job | undefined {
    const row = this.db.prepare(`UPDATE jobs SET status='processing',updated_at=?
      WHERE id=(SELECT id FROM jobs WHERE status='pending' ORDER BY created_at,rowid LIMIT 1)
      RETURNING *`).get(Date.now()) as Row | undefined;
    return row ? this.decode(row) : undefined;
  }
  private decode(row: Row): Job {
    return { id: row.id, payload: JSON.parse(row.payload), status: row.status,
      decision: row.decision ? JSON.parse(row.decision) : null, error: row.error };
  }
  getJob(id: string): Job | undefined {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id) as Row | undefined;
    return row ? this.decode(row) : undefined;
  }
  listJobs(): Job[] {
    return (this.db.prepare("SELECT * FROM jobs ORDER BY created_at DESC,rowid DESC LIMIT 50").all() as Row[]).map(r => this.decode(r));
  }
  conversation(leadId: number): Conversation {
    const row = this.db.prepare("SELECT value FROM conversations WHERE lead_id=?").get(leadId) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : { leadId, profile: {}, messages: [], status: "collecting", noteId: null };
  }
  saveConversation(value: Conversation): void {
    // Retain a bounded conversation; full native chat history stays in Kommo.
    this.db.prepare("INSERT INTO conversations(lead_id,value) VALUES(?,?) ON CONFLICT(lead_id) DO UPDATE SET value=excluded.value")
      .run(value.leadId, JSON.stringify({ ...value, messages: value.messages.slice(-40) }));
  }
  finish(id: string, decision: Decision): void {
    this.db.prepare("UPDATE jobs SET status='done',decision=?,updated_at=? WHERE id=?")
      .run(JSON.stringify(decision), Date.now(), id);
  }
  fail(id: string, code: string): void {
    this.db.prepare("UPDATE jobs SET status='needs_review',error=?,updated_at=? WHERE id=?")
      .run(code.slice(0, 160), Date.now(), id);
  }
  simulatedReply(jobId: string, value: unknown): void {
    this.db.prepare("INSERT INTO simulation_replies(job_id,value) VALUES(?,?)").run(jobId, JSON.stringify(value));
  }
  close(): void { this.db.close(); }
}
