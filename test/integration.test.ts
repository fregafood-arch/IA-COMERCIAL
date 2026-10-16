import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { SignJWT } from "jose";
import OpenAI from "openai";
import { loadConfig, type Config } from "../src/config.js";
import { decide, qualificationSchema, type Analysis, type Decision, type Inbound } from "../src/domain.js";
import { authenticate, jobId, validateCallback } from "../src/auth.js";
import { Store } from "../src/store.js";
import { OpenAiQualifier, SimulationQualifier } from "../src/ai.js";
import { KommoGateway, KommoError, SimulationGateway, type CrmGateway } from "../src/kommo.js";
import { Worker } from "../src/worker.js";
import { buildApp } from "../src/app.js";

const spec = qualificationSchema.parse(JSON.parse(readFileSync("qualification.json", "utf8")));
const base = loadConfig({ INTEGRATION_MODE: "simulation", DATABASE_PATH: ":memory:" });
const live: Config = { ...base, mode: "live", kommoClientSecret: "local-test-secret-not-a-real-credential", kommoAccessToken: "local-test-token",
  gptKey: "local-test-key", publicUrl: "https://integration.example.com", adminToken: "local-test-admin" };
const completePF = { contract_type: "pf", profession: "clt", people_count: "2", ages: "32,30", state: "sp", city: "São Paulo", current_plan: "nao", name: "Ana", whatsapp: "11999990000" };
const analysis = (extracted: Record<string,string|null>): Analysis => ({ reply: "Qual seu nome?", extracted, handoff: false, reason: "test", next_field: "name" });
function inbound(leadId=123, continuation=456): Inbound {
  return { token: "not-yet-signed", return_url: `${live.kommoUrl}/api/v4/salesbot/9/continue/${continuation}`,
    data: { lead_id: leadId, message: "Quero cotar", channel: "instagram", context: "private_chat" } };
}
async function sign(data: Inbound, claims: Record<string,unknown> = {}) {
  const now=Math.floor(Date.now()/1000);
  data.token=await new SignJWT({ subdomain:"suporteexodosaudecom", entity_id:data.data.lead_id, entity_type:"lead", ...claims })
    .setProtectedHeader({alg:"HS256"}).setIssuer(live.kommoUrl).setAudience(live.publicUrl!)
    .setIssuedAt(now).setNotBefore(now-1).setExpirationTime(now+300).sign(new TextEncoder().encode(live.kommoClientSecret));
  return data;
}
const noCrm: CrmGateway = { async syncLead(){return null;}, async continueBot(){} };

test("site fields: PF requires profession; CNPJ requires company age; both remain eligible for service", () => {
  const pf=decide(spec,{},analysis(completePF));
  assert.equal(pf.status,"ready"); assert.deepEqual(pf.missing,[]);
  const mei=decide(spec,{},analysis({...completePF,contract_type:"mei",profession:null}));
  assert.equal(mei.status,"collecting"); assert.deepEqual(mei.missing,["cnpj_age"]);
  const ready=decide(spec,mei.profile,analysis({cnpj_age:"menos6"}));
  assert.equal(ready.status,"ready"); assert.equal(ready.profile.profession,undefined);
});
test("existing plan requires spending range; refusing to disclose is a valid answer", () => {
  const pending=decide(spec,{},analysis({...completePF,current_plan:"empresa"}));
  assert.deepEqual(pending.missing,["current_cost"]);
  const done=decide(spec,pending.profile,analysis({current_cost:"nd"}));
  assert.equal(done.status,"ready");
  assert.equal(decide(spec,done.profile,analysis({current_plan:"nao"})).profile.current_cost,undefined);
});
test("ages must match small groups and be valid; ages become optional above ten lives", () => {
  assert.ok(decide(spec,{},analysis({...completePF,ages:"32"})).missing.includes("ages"));
  assert.ok(decide(spec,{},analysis({...completePF,ages:"111,30"})).missing.includes("ages"));
  const big=decide(spec,{},analysis({...completePF,people_count:"20",ages:null}));
  assert.equal(big.status,"ready");
});
test("unknown fields and invalid phones cannot qualify a lead or overwrite known data", () => {
  const value=decide(spec,{name:"Ana"},analysis({...completePF,name:null,whatsapp:"123",invented:"ignored"}));
  assert.equal(value.profile.name,"Ana"); assert.equal(value.profile.invented,undefined);
  assert.equal(value.status,"collecting"); assert.ok(value.missing.includes("whatsapp"));
});
test("customer request for a human interrupts qualification", () => {
  const value=decide(spec,{}, {...analysis({}),handoff:true});
  assert.equal(value.status,"handoff"); assert.match(value.reply,/equipe/);
});
test("webhook JWT binds the account, audience and lead, and rejects forgery", async () => {
  const value=await sign(inbound());
  await authenticate(value,live);
  await assert.rejects(authenticate({...value,data:{...value.data,lead_id:999}},live));
  await assert.rejects(authenticate({...value,token:value.token.slice(0,-4)+"xxxx"},live));
  await assert.rejects(authenticate(await sign(inbound(),{subdomain:"other-account"}),live));
});
test("callbacks cannot redirect credentials to another host, URL, or account", () => {
  for(const url of ["https://evil.example/api/v4/salesbot/9/continue/456",live.kommoUrl+"/api/v4/leads",live.kommoUrl+"/api/v4/salesbot/9/continue/456?next=evil",live.kommoUrl+".evil.example/api/v4/salesbot/9/continue/456"])
    assert.throws(()=>validateCallback(url,live.kommoUrl));
});
test("Kommo webhook acknowledges before GPT finishes, queues durably and deduplicates replay", async () => {
  const store=new Store(":memory:"); let calls=0, release!:()=>void;
  const blocked=new Promise<void>(resolve=>{release=resolve});
  const worker=new Worker(store,spec,{async analyze(){calls++;await blocked;return analysis(completePF);}},noCrm);
  const app=buildApp(live,store,worker);
  const payload=await sign(inbound());
  const response=await app.inject({method:"POST",url:"/webhooks/kommo/salesbot",payload});
  assert.equal(response.statusCode,200); assert.equal(response.json().accepted,true);
  const duplicate=await app.inject({method:"POST",url:"/webhooks/kommo/salesbot",payload});
  assert.equal(duplicate.json().duplicate,true);
  release(); await worker.drain();
  assert.equal(calls,1); assert.equal(store.getJob(jobId(payload))?.status,"done");
  await app.close();store.close();
});
test("invalid or unsigned requests cannot enter the queue", async () => {
  const store=new Store(":memory:"),worker=new Worker(store,spec,new SimulationQualifier(spec),noCrm),app=buildApp(live,store,worker);
  const invalid=await app.inject({method:"POST",url:"/webhooks/kommo/salesbot",payload:inbound()});
  assert.equal(invalid.statusCode,401); assert.equal(store.listJobs().length,0);
  const missing=await app.inject({method:"POST",url:"/webhooks/kommo/salesbot",payload:{}});
  assert.equal(missing.statusCode,400);
  assert.equal((await app.inject({url:"/api/status"})).statusCode,401);
  assert.equal((await app.inject({method:"POST",url:"/api/simulate",payload:{message:"Hi"}})).statusCode,404);
  await app.close();store.close();
});
test("public comments receive a private-chat invitation without sending personal data to GPT", async () => {
  const store=new Store(":memory:");let calls=0;const replies:Decision[]=[];
  const worker=new Worker(store,spec,{async analyze(){calls++;return analysis({});}},{...noCrm,async continueBot(_j,d){replies.push(d);}});
  const value=inbound();value.data.context="public_comment";
  store.enqueue(jobId(value),value);await worker.drain();
  assert.equal(calls,0);assert.equal(replies[0]?.status,"private_chat");assert.match(replies[0]!.reply,/privada/);
  assert.deepEqual(store.conversation(123).profile,{});store.close();
});
test("qualification updates the existing Kommo lead, adds a note, then continues the native Salesbot", async () => {
  const requests:{url:string;method:string;body:any}[]=[];
  const fetcher:typeof fetch=async(input,init)=>{
    const url=String(input);requests.push({url,method:init!.method!,body:JSON.parse(String(init!.body))});
    if(url.endsWith("/api/v4/leads/notes")&&init!.method==="POST") return Response.json({_embedded:{notes:[{id:777}]}});
    return new Response(null,{status:204});
  };
  const store=new Store(":memory:");
  const config={...live,fieldMap:{whatsapp:111,contract_type:222},pipelineId:10,readyStatusId:20};
  const worker=new Worker(store,spec,{async analyze(){return analysis(completePF);}},new KommoGateway(config,fetcher));
  const value=inbound();store.enqueue(jobId(value),value);await worker.drain();
  assert.equal(store.getJob(jobId(value))?.status,"done");
  assert.deepEqual(requests.map(r=>r.method),["PATCH","POST","POST"]);
  assert.equal(requests[0]!.body[0].id,123);assert.equal(requests[0]!.body[0].status_id,20);
  assert.equal(requests[1]!.body[0].entity_id,123);assert.match(requests[1]!.body[0].params.text,/Ana/);
  assert.equal(requests[2]!.body.data.ready,"yes");assert.equal(requests[2]!.body.data.commercial_qualified,"no");
  assert.equal(requests[2]!.body.execute_handlers,undefined);
  assert.ok(requests.every(r=>new URL(r.url).origin===live.kommoUrl));
  assert.ok(!requests.some(r=>r.method==="POST"&&r.url.endsWith("/api/v4/leads")));
  assert.equal(store.conversation(123).noteId,777);store.close();
});
test("uncertain message delivery requires review and never automatically resends", async () => {
  const store=new Store(":memory:");let sends=0;
  const worker=new Worker(store,spec,{async analyze(){return analysis({});}},{...noCrm,async continueBot(){sends++;throw new KommoError("continue",503);}});
  const value=inbound();store.enqueue(jobId(value),value);await worker.drain();await worker.drain();
  assert.equal(sends,1);assert.equal(store.getJob(jobId(value))?.status,"needs_review");store.close();
});
test("persistent queue survives restart, removes JWTs and isolates interrupted jobs", () => {
  const temp=mkdtempSync(join(tmpdir(),"ia-comercial-test-")),path=join(temp,"store.sqlite");
  let store=new Store(path);const value=inbound();value.token="secret-jwt-must-not-be-stored";
  store.enqueue(jobId(value),value);store.claim();store.close();
  store=new Store(path);assert.equal(store.getJob(jobId(value))?.status,"needs_review");
  assert.ok(!JSON.stringify(store.listJobs()).includes(value.token));store.close();rmSync(temp,{recursive:true});
});
test("OpenAI SDK sends a strict structured schema and parses extracted data", async () => {
  let request:any;
  const extracted=Object.fromEntries(spec.fields.map(f=>[f.key,null]));
  const answer={reply:"Você tem CNPJ?",extracted,handoff:false,reason:"Faltam dados",next_field:"contract_type"};
  const client=new OpenAI({apiKey:"local-test-key",fetch:async(_url,init)=>{
    request=JSON.parse(String(init?.body));
    return Response.json({id:"resp_test",object:"response",created_at:1,status:"completed",error:null,incomplete_details:null,
      output:[{id:"msg_test",type:"message",role:"assistant",status:"completed",content:[{type:"output_text",text:JSON.stringify(answer),annotations:[]}]}]});
  }});
  const qualifier=new OpenAiQualifier(spec,client,"gpt-4.1-mini");
  const result=await qualifier.analyze({leadId:1,profile:{},messages:[],status:"collecting"},"Quero um plano");
  assert.equal(result.next_field,"contract_type");assert.equal(request.store,false);
  assert.equal(request.text.format.type,"json_schema");assert.equal(request.text.format.strict,true);
  assert.match(request.instructions,/Não invente/);
});
test("simulation endpoint exercises the full local flow without external credentials", async () => {
  const store=new Store(":memory:"),worker=new Worker(store,spec,new SimulationQualifier(spec),new SimulationGateway(store)),app=buildApp(base,store,worker);
  const response=await app.inject({method:"POST",url:"/api/simulate",payload:{lead_id:12,message:Object.entries(completePF).map(([k,v])=>`${k}: ${v}`).join("; ")}});
  assert.equal(response.statusCode,200);assert.equal(response.json().decision.status,"ready");
  assert.equal((await app.inject({url:"/health"})).json().message_delivery,"kommo_salesbot");
  assert.match((await app.inject({url:"/"})).body,/Simulação local/);await app.close();store.close();
});
test("Salesbot widget replies through native show and exposes routing exits", () => {
  let Widget:any;
  vm.runInNewContext(readFileSync("widget/script.js","utf8"),{URL,define:(_deps:unknown,factory:()=>unknown)=>{Widget=factory();}});
  const widget=new Widget();
  const blocks=JSON.parse(widget.callbacks.onSalesbotDesignerSave("qualify",{endpoint:"https://integration.example.com/webhooks/kommo/salesbot",channel:"instagram",context:"private_chat"}));
  assert.equal(blocks[0].question[0].params.data.message,"{{message_text}}");
  assert.equal(blocks[2].question[0].handler,"show");assert.equal(blocks[2].question[0].params.value,"{{json.reply}}");
  assert.equal(widget.callbacks.salesbotDesignerSettings().exits.length,4);
  assert.ok(!JSON.stringify(blocks).includes("graph.facebook"));
});
test("live configuration fails clearly when required credentials are absent", () => {
  assert.throws(()=>loadConfig({INTEGRATION_MODE:"live"}),/GPT_API_KEY.*KOMMO_ACCESS_TOKEN/);
});
test("switching to simulation cannot expose a database marked for live conversations", () => {
  const temp=mkdtempSync(join(tmpdir(),"ia-comercial-modes-")),path=join(temp,"store.sqlite");
  const production=new Store(path,"live");production.close();
  assert.throws(()=>new Store(path,"simulation"),/another integration mode/);
  const reopened=new Store(path,"live");reopened.close();rmSync(temp,{recursive:true});
});
