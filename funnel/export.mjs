import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const db=new DatabaseSync(path.resolve(process.env.DATA_DIR||'data','leads.sqlite'),{readOnly:true});
const rows=db.prepare('SELECT id, created_at, route, delivery, attempts, payload FROM leads ORDER BY created_at').all();
const escape=value=>'"'+String(value??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
const columns=['id','created_at','route','delivery','attempts','business_name','owner_name','email','phone_number','industry','revenue_tier','ticket_value','budget_confirmation','phone_consent','email_consent'];
const csv=[columns.join(','),...rows.map(r=>{const data={...r,...JSON.parse(r.payload).prospect};return columns.map(k=>escape(data[k])).join(',');})].join('\r\n');
mkdirSync('exports',{recursive:true,mode:0o700});const filename='exports/leads-'+Date.now()+'.csv';writeFileSync(filename,csv,{mode:0o600});db.close();console.log('Saved',rows.length,'leads to',filename);
