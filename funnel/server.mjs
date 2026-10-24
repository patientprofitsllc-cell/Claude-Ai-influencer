import http from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHmac } from 'node:crypto';

const here=path.dirname(fileURLToPath(import.meta.url));
export const industries=['detailing','home-services','wellness','professional-services','other'];
const revenueTiers=['under-5k','5k-15k','15k-50k','50k-plus'];
const consentVersion='2026-10-24-v1';
const consentText={phone:'I agree to receive automated calls and texts from Patient Creations about this request at the number provided. Consent is optional and is not required to book or buy. Message and data rates may apply. Reply STOP to opt out.',email:'Send me helpful templates and occasional service updates by email. I can unsubscribe at any time.'};
export function validateLead(input){
  if(!input||typeof input!=='object'||Array.isArray(input))return {error:'Please complete the form.'};
  const clean={};
  for(const [key,max] of Object.entries({business_name:120,owner_name:100,email:254,phone_number:30,website_url:500})){
    if(typeof input[key]!=='string'||input[key].length>max)return {error:'Check the contact details and try again.'};
    clean[key]=input[key].trim();
  }
  if(clean.business_name.length<2||clean.owner_name.length<2)return {error:'Enter your business name and contact name.'};
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email))return {error:'Enter a valid email address.'};
  if(clean.phone_number&&!/^\+?[\d\s().-]{7,30}$/.test(clean.phone_number))return {error:'Check your phone number.'};
  if(clean.phone_number&&clean.phone_number.replace(/\D/g,'').length<7)return {error:'Check your phone number.'};
  if(!industries.includes(input.industry)||!revenueTiers.includes(input.revenue_tier)||!['yes','no'].includes(input.budget_confirmation))return {error:'Choose an industry, revenue range and budget answer.'};
  if(typeof input.ticket_value!=='number'||!Number.isFinite(input.ticket_value)||input.ticket_value<=0||input.ticket_value>10000000)return {error:'Enter a customer value greater than zero.'};
  for(const field of ['phone_consent','email_consent','privacy_ack'])if(typeof input[field]!=='boolean')return {error:'Check your contact preferences.'};
  if(!input.privacy_ack)return {error:'Please read and acknowledge the privacy notice.'};
  if(input.phone_consent&&!clean.phone_number)return {error:'Add a phone number to request calls or texts.'};
  if(clean.website_url.toLowerCase()==='none')clean.website_url='';
  if(clean.website_url){try{const url=new URL(clean.website_url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error();}catch{return {error:'Use a full website address, such as https://example.com, or leave it blank.'}}}
  return {value:{...clean,industry:input.industry,revenue_tier:input.revenue_tier,ticket_value:input.ticket_value,budget_confirmation:input.budget_confirmation,phone_consent:input.phone_consent,email_consent:input.email_consent,privacy_ack:true}};
}
export function createApp(options={}){
  const dataDir=options.dataDir||process.env.DATA_DIR||path.join(here,'data');
  mkdirSync(dataDir,{recursive:true,mode:0o700});
  const db=new DatabaseSync(path.join(dataDir,'leads.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS leads (id TEXT PRIMARY KEY, request_key TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL, route TEXT NOT NULL, payload TEXT NOT NULL, delivery TEXT NOT NULL DEFAULT \'pending\', attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0)');
  const webhook=options.webhook??process.env.AUTOMATION_WEBHOOK_URL??'';
  const secret=options.secret??process.env.AUTOMATION_WEBHOOK_SECRET??'';
  if(Boolean(webhook)!==Boolean(secret))throw Error('Set both AUTOMATION_WEBHOOK_URL and AUTOMATION_WEBHOOK_SECRET.');
  if(webhook){const u=new URL(webhook);if(u.protocol!=='https:'||u.username||u.password)throw Error('Automation webhook must use HTTPS without URL credentials.');if(secret.length<24)throw Error('Webhook signing secret must contain at least 24 characters.');}
  const calendar=options.calendar||process.env.CALENDAR_URL||'https://cal.com/patientcreations/15min';
  const calendarURL=new URL(calendar);if(calendarURL.protocol!=='https:'||calendarURL.username||calendarURL.password)throw Error('CALENDAR_URL must use HTTPS.');
  const sendFetch=options.fetch||fetch;
  const limits=new Map();let dispatching=false;
  async function dispatch(){
    if(!webhook||dispatching)return;
    dispatching=true;
    try{for(const row of db.prepare("SELECT * FROM leads WHERE delivery='pending' AND next_attempt<=? ORDER BY created_at LIMIT 10").all(Date.now())){
      try{
        const signature=createHmac('sha256',secret).update(row.payload).digest('hex');
        const response=await sendFetch(webhook,{method:'POST',headers:{'Content-Type':'application/json','X-Webhook-Signature':`sha256=${signature}`,'Idempotency-Key':row.id},body:row.payload,signal:AbortSignal.timeout(10000),redirect:'error'});
        if(!response.ok)throw Error('Delivery rejected');
        if(response.body)await response.body.cancel();
        db.prepare("UPDATE leads SET delivery='delivered', attempts=attempts+1 WHERE id=?").run(row.id);
      }catch{
        const attempts=row.attempts+1;
        db.prepare('UPDATE leads SET delivery=?,attempts=?,next_attempt=? WHERE id=?').run(attempts>=8?'failed':'pending',attempts,Date.now()+Math.min(3600000,30000*2**attempts),row.id);
        console.error('Automation delivery failed for event',row.id,'attempt',attempts);
      }
    }}finally{dispatching=false;}
  }
  const timer=setInterval(()=>{const now=Date.now();for(const [key,value] of limits)if(value.until<now)limits.delete(key);void dispatch().catch(()=>console.error('Automation queue unavailable'));},30000);timer.unref();
  const security={'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'Cache-Control':'no-store'};
  const json=(res,status,data)=>{res.writeHead(status,{...security,'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  const staticFiles=new Map([['/','index.html'],['/app.js','app.js'],['/style.css','style.css'],['/hero.webp','hero.webp'],['/hero-720.webp','hero-720.webp'],['/privacy','privacy.html'],['/resources','resources.html'],['/downloads/visibility-checklist.txt','visibility-checklist.txt'],['/downloads/content-planner.csv','content-planner.csv']]);
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost');
      if(req.method==='GET'&&url.pathname==='/health')return json(res,200,{ok:true});
      if(req.method==='GET'&&url.pathname==='/api/config')return json(res,200,{calendar_url:calendar});
      if(req.method==='POST'&&url.pathname==='/api/leads'){
        if(req.headers.origin){try{if(new URL(req.headers.origin).host!==req.headers.host)return json(res,403,{error:'Submit the form from this website.'});}catch{return json(res,403,{error:'Invalid request origin.'});}}
        if(!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{error:'Send a JSON form submission.'});
        const ip=process.env.TRUST_PROXY==='1'?(String(req.headers['x-forwarded-for']||req.socket.remoteAddress).split(',')[0].trim()):req.socket.remoteAddress;
        const now=Date.now();let bucket=limits.get(ip);if(!bucket||bucket.until<now){bucket={count:0,until:now+600000};limits.set(ip,bucket);}if(++bucket.count>20)return json(res,429,{error:'Too many attempts. Please wait ten minutes before trying again.'});
        let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>16384)return json(res,413,{error:'The form is too large.'});}
        let input;try{input=JSON.parse(body);}catch{return json(res,400,{error:'The form could not be read.'});}
        if(input?.company_fax)return json(res,400,{error:'Unable to accept this submission.'});
        const key=req.headers['idempotency-key'];if(typeof key!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(key))return json(res,400,{error:'Refresh the page and try again.'});
        const validated=validateLead(input);if(validated.error)return json(res,400,validated);
        const existing=db.prepare('SELECT id,route FROM leads WHERE request_key=?').get(key);
        if(existing)return json(res,200,{id:existing.id,route:existing.route,calendar_url:existing.route==='qualified'?calendar:null,resources_url:'/resources'});
        const lead=validated.value,route=lead.revenue_tier!=='under-5k'&&lead.budget_confirmation==='yes'?'qualified':'resources';
        const id=randomUUID(),createdAt=new Date().toISOString();
        const action=route==='qualified'?(lead.phone_consent?'execute_outbound_prescreen':'manual_review'):(lead.email_consent?'send_resource_email_sequence':'resources_only');
        const payload={event_id:id,event_type:route==='qualified'?'form_submission_qualified':'form_submission_resources',timestamp:createdAt,prospect:lead,consent:{version:consentVersion,phone:lead.phone_consent,email:lead.email_consent,recorded_at:createdAt,text:consentText},routing:{action,target_agent_id:action==='execute_outbound_prescreen'?'ava_assistant_v4_prod':null,calendar_payload_url:calendar}};
        db.prepare('INSERT INTO leads (id,request_key,created_at,route,payload) VALUES (?,?,?,?,?)').run(id,key,createdAt,route,JSON.stringify(payload));
        json(res,201,{id,route,calendar_url:route==='qualified'?calendar:null,resources_url:'/resources'});
        void dispatch().catch(()=>console.error('Automation queue unavailable'));
        return;
      }
      if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Method not allowed.'});
      const file=staticFiles.get(url.pathname)||(industries.some(i=>url.pathname===`/grow-${i}`)?'index.html':null);
      if(!file)return json(res,404,{error:'Page not found.'});
      const ext=path.extname(file),types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.txt':'text/plain; charset=utf-8','.csv':'text/csv; charset=utf-8','.webp':'image/webp'};
      const headers={...security,'Content-Type':types[ext]};
      if(ext==='.webp')headers['Cache-Control']='public, max-age=604800';
      if(url.pathname.startsWith('/downloads/'))headers['Content-Disposition']=`attachment; filename="${file}"`;
      res.writeHead(200,headers);res.end(req.method==='HEAD'?undefined:readFileSync(path.join(here,'public',file)));
    }catch{if(!res.headersSent)json(res,500,{error:'We could not save your request. Please try again.'});else res.end();}
  });
  return {server,db,dispatch,close:async()=>{clearInterval(timer);await new Promise(resolve=>server.close(resolve));while(dispatching)await new Promise(resolve=>setTimeout(resolve,50));db.close();}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=createApp();app.server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log('Patient Creations listening on port',app.server.address().port));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void app.close().then(()=>process.exit(0)));
}
