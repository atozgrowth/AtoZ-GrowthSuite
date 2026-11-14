import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { PostgresAdsRepository } from '../../backend/dist/integrations/postgres-ads-repository.js';
import { TenantAdsAdapter, sealAdsEnvelope, openAdsEnvelope } from '../../backend/dist/integrations/tenant-google-ads.js';
const config={host:'postgres',database:'fixture',user:'postgres',password:'synthetic-postgres'};
const admin=new pg.Pool(config),server=new pg.Pool({...config,options:'-c role=service_role',max:12});
const user='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const connection='20000000-0000-4000-8000-000000000001',foreign='20000000-0000-4000-8000-000000000002';
const actor={userId:user,workspaceId:user},otherActor={userId:other,workspaceId:other};
const key=randomBytes(32),redirectUri='https://fixture.example.test/auth/callback';
const repo=new PostgresAdsRepository(server),checks=[];
let step='setup';
async function check(name,fn){step=name;await fn();checks.push(name);}
const hash=v=>createHash('sha256').update(v).digest('hex');
let exchanges=0,reports=0,expectedChallenge;
const provider={async exchange({verifier}){exchanges++;if(expectedChallenge)assert.equal(createHash('sha256').update(verifier).digest('base64url'),expectedChallenge);return {accessToken:'synthetic-access-only',refreshToken:'synthetic-refresh-only',expiresAt:Date.now()+600000};},async report({query,customerId}){reports++;assert.equal(customerId,'1234567890');assert.ok(query.startsWith('SELECT campaign.id'));assert.ok(query.endsWith('LIMIT 500'));return [{campaign:{id:'101',name:'Synthetic campaign',status:'PAUSED'},metrics:{impressions:'10',clicks:'2',costMicros:'9007199254740993',conversions:'1.5'}}];}};
const adapter=new TenantAdsAdapter(repo,provider,key,{mode:'offline-test',redirectUri});
async function begin(){const r=await adapter.begin(actor,connection);assert.equal(r.ok,true);return r.value;}
try{
 await admin.query("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);");
 await admin.query('INSERT INTO auth.users VALUES($1),($2)',[user,other]);
 await admin.query(await readFile('/app/migration.sql','utf8'));
 await admin.query('INSERT INTO private.ads_connections(id,user_id,customer_ids) VALUES($1,$2,$3),($4,$5,$3)',[connection,user,['1234567890'],foreign,other]);
 await check('PostgreSQL private RLS and least-privilege browser denial',async()=>{
  const rows=(await admin.query("SELECT relrowsecurity FROM pg_class WHERE oid IN ('private.ads_connections'::regclass,'private.ads_oauth_states'::regclass,'private.ads_token_envelopes'::regclass)")).rows;
  assert.equal(rows.length,3);assert.ok(rows.every(r=>r.relrowsecurity));
  for(const role of ['anon','authenticated'])for(const table of ['ads_connections','ads_oauth_states','ads_token_envelopes']){
   const c=await admin.connect();try{await c.query('BEGIN; SET LOCAL ROLE '+role);await assert.rejects(c.query('SELECT * FROM private.'+table));}finally{await c.query('ROLLBACK');c.release();}
  }
  assert.equal((await admin.query("SELECT has_table_privilege('service_role','private.ads_token_envelopes','TRUNCATE,TRIGGER,MAINTAIN,REFERENCES') AS dangerous")).rows[0].dangerous,false);
 });
 await check('authoritative tenant binding excludes foreign connection',async()=>{assert.equal(await repo.binding(user,foreign),null);assert.equal((await adapter.begin(otherActor,connection)).ok,false);assert.equal((await adapter.begin({...actor,workspaceId:other},connection)).ok,false);});
 let started;
 await check('PKCE state stored hashed and verifier encrypted only',async()=>{started=await begin();expectedChallenge=started.challenge;const row=(await admin.query('SELECT encode(digest,\'hex\') AS digest,verifier FROM private.ads_oauth_states WHERE digest=$1',[Buffer.from(hash(started.state),'hex')])).rows[0];assert.equal(row.digest,hash(started.state));assert.ok(!JSON.stringify(row).includes(started.state));assert.equal(Object.keys(row.verifier).sort().join(','),'ciphertext,nonce,tag,version');});
 await check('concurrent callbacks consume once across actual PG workers',async()=>{const before=exchanges;const responses=await Promise.all([adapter.callback(actor,connection,started.state,'synthetic-code'),adapter.callback(actor,connection,started.state,'synthetic-code')]);assert.equal(responses.filter(r=>r.ok).length,1);assert.equal(exchanges,before+1);});
 await check('real encrypted persistence feeds bounded mocked reporting',async()=>{const r=await adapter.campaignReport(actor,connection,'1234567890');assert.equal(r.ok,true);assert.equal(r.value.campaigns[0].costMicros,'9007199254740993');assert.equal(r.value.complete,false);const raw=JSON.stringify((await admin.query('SELECT envelope FROM private.ads_token_envelopes')).rows);assert.ok(!raw.includes('synthetic-access'));assert.ok(!raw.includes('synthetic-refresh'));});
 await check('unauthorized account and foreign actor never call provider',async()=>{const before=reports;assert.equal((await adapter.campaignReport(actor,connection,'9999999999')).ok,false);assert.equal((await adapter.campaignReport(otherActor,connection,'1234567890')).ok,false);assert.equal(reports,before);});
 await check('database clock denies expired state even with forged input clock',async()=>{const r=await begin();await admin.query("UPDATE private.ads_oauth_states SET created_at=clock_timestamp()-interval '10 minutes',expires_at=clock_timestamp()-interval '1 second' WHERE digest=$1",[Buffer.from(hash(r.state),'hex')]);assert.equal(await repo.consumeState({digest:hash(r.state),userId:user,connectionId:connection,bindingRevision:1,redirectUri,now:0}),null);assert.equal((await adapter.callback(actor,connection,r.state,'synthetic-code')).ok,false);});
 await check('state redirect and owner mismatches cannot consume valid state',async()=>{const r=await begin();assert.equal(await repo.consumeState({digest:hash(r.state),userId:user,connectionId:connection,bindingRevision:1,redirectUri:'https://other.example.test/callback',now:Date.now()}),null);assert.equal(await repo.consumeState({digest:hash(r.state),userId:other,connectionId:connection,bindingRevision:1,redirectUri,now:Date.now()}),null);expectedChallenge=r.challenge;assert.equal((await adapter.callback(actor,connection,r.state,'synthetic-code')).ok,true);});
 await check('revision rotation is atomic and invalidates old states/tokens',async()=>{const r=await begin();const responses=await Promise.all([repo.rotateAccounts(user,connection,1,['1234567890']),repo.rotateAccounts(user,connection,1,['1234567890'])]);assert.equal(responses.filter(v=>v===2).length,1);assert.equal(responses.filter(v=>v===null).length,1);assert.equal(await repo.loadTokens(user,connection,1),null);assert.equal((await adapter.callback(actor,connection,r.state,'synthetic-code')).ok,false);assert.equal((await admin.query('SELECT count(*)::int AS n FROM private.ads_token_envelopes WHERE connection_id=$1',[connection])).rows[0].n,0);});
 await check('stale state insertion cannot race a revised binding',async()=>{await assert.rejects(repo.createState({digest:hash('stale-fixture'),userId:user,connectionId:connection,bindingRevision:1,redirectUri,expiresAt:Date.now()+300000,verifier:sealAdsEnvelope(key,user,connection,'pkce','synthetic')}));});
 await check('encrypted envelope cannot move across tenant or revision',async()=>{const encrypted=sealAdsEnvelope(key,user,connection,'tokens:2',{accessToken:'synthetic',refreshToken:'synthetic',expiresAt:Date.now()+60000});assert.throws(()=>openAdsEnvelope(key,other,foreign,'tokens:2',encrypted));assert.throws(()=>openAdsEnvelope(key,user,connection,'tokens:3',encrypted));});
 await check('state and vault schema rejects plaintext or extra-key envelopes',async()=>{await assert.rejects(repo.saveTokensIfActive(user,connection,2,{version:1,nonce:'bad',ciphertext:'plaintext',tag:'bad'}));await assert.rejects(admin.query("INSERT INTO private.ads_token_envelopes(connection_id,user_id,binding_revision,envelope) VALUES($1,$2,2,'{}'::jsonb)",[connection,user]));});
 await check('revocation during token exchange blocks post-provider token write',async()=>{const r=await begin();expectedChallenge=undefined;const revoking=new TenantAdsAdapter(repo,{...provider,async exchange(){await repo.revoke(user,connection,2);return {accessToken:'synthetic',refreshToken:'synthetic',expiresAt:Date.now()+60000};}},key,{mode:'offline-test',redirectUri});assert.equal((await revoking.callback(actor,connection,r.state,'synthetic-code')).ok,false);assert.equal((await admin.query('SELECT count(*)::int AS n FROM private.ads_token_envelopes WHERE connection_id=$1',[connection])).rows[0].n,0);});
 await check('foreign revocation and account rotation cannot affect ownership',async()=>{assert.equal(await repo.revoke(other,connection,3),false);assert.equal(await repo.rotateAccounts(other,connection,3,['1234567890']),null);assert.equal((await repo.binding(user,connection)).userId,user);});
 await check('token-save versus revoke serializes without surviving stale tokens',async()=>{for(let n=0;n<10;n++){await admin.query('UPDATE private.ads_connections SET active=true,revision=$2 WHERE id=$1',[connection,10+n]);const value=sealAdsEnvelope(key,user,connection,'tokens:'+(10+n),{accessToken:'synthetic',refreshToken:'synthetic',expiresAt:Date.now()+60000});await Promise.all([repo.saveTokensIfActive(user,connection,10+n,value),repo.revoke(user,connection,10+n)]);assert.equal((await repo.binding(user,connection)).active,false);assert.equal((await admin.query('SELECT count(*)::int AS n FROM private.ads_token_envelopes WHERE connection_id=$1',[connection])).rows[0].n,0);}});
 await check('disabled adapter remains inert with real repository',async()=>{const before=exchanges+reports;const disabled=new TenantAdsAdapter(repo,provider,key,{mode:'disabled',redirectUri});assert.equal((await disabled.begin(actor,connection)).ok,false);assert.equal(exchanges+reports,before);});
 const version=(await admin.query('SHOW server_version')).rows[0].server_version;
 await writeFile('/evidence/evidence.json',JSON.stringify({actual_postgresql:true,postgres_version:version,checks_passed:checks.length,checks,provider_requests_mocked:true,live_provider_calls:0,production_credentials_loaded:false,secrets_in_report:false},null,2));
}catch{console.error('Isolated Ads PostgreSQL check failed:',step);process.exitCode=1;}
finally{await server.end();await admin.end();}
