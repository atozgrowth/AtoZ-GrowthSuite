import test from 'node:test';
import assert from 'node:assert/strict';
import { TenantAdsAdapter,sealAdsEnvelope,openAdsEnvelope,type AdsRepository,type AdsProvider,type AdsBinding,type AdsEnvelope } from './tenant-google-ads.js';
const user='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',connection='20000000-0000-4000-8000-000000000001';
const actor={userId:user,workspaceId:user},key=Buffer.alloc(32,7),redirectUri='https://app.example.test/auth/google-ads/callback';
function fixture(){
 let now=1000000,binding:AdsBinding={userId:user,connectionId:connection,revision:1,active:true,customerIds:['1234567890']};
 const states=new Map<string,Parameters<AdsRepository['createState']>[0]>(),vault=new Map<string,AdsEnvelope>();let exchanges=0,reports=0,verifier='',query='';
 const repo:AdsRepository={binding:async(u,c)=>u===binding.userId&&c===binding.connectionId?binding:null,
  createState:async row=>{if(states.has(row.digest))throw Error('duplicate');states.set(row.digest,row);},
  consumeState:async input=>{const row=states.get(input.digest);if(!row||row.userId!==input.userId||row.connectionId!==input.connectionId||row.redirectUri!==input.redirectUri||row.bindingRevision!==input.bindingRevision||row.expiresAt<=input.now)return null;states.delete(input.digest);return row;},
  saveTokensIfActive:async(u,c,r,t)=>{if(u!==binding.userId||c!==binding.connectionId||r!==binding.revision||!binding.active)return false;vault.set(c,t);return true;},
  loadTokens:async(u,c,r)=>u===binding.userId&&c===binding.connectionId&&binding.active&&r===binding.revision?vault.get(c)??null:null};
 const provider:AdsProvider={exchange:async input=>{exchanges++;verifier=input.verifier;return{accessToken:'synthetic-access',refreshToken:'synthetic-refresh',expiresAt:now+10000};},report:async input=>{reports++;query=input.query;return[{campaign:{id:'1',name:'Synthetic',status:'PAUSED'},metrics:{impressions:'2',clicks:'1',costMicros:'9007199254740993',conversions:'0'}}];}};
 const adapter=new TenantAdsAdapter(repo,provider,key,{mode:'offline-test',redirectUri},()=>now);
 return{adapter,repo,provider,states,vault,verifier:()=>verifier,exchanges:()=>exchanges,reports:()=>reports,query:()=>query,expire:()=>{now+=400000;},revoke:()=>{binding={...binding,active:false,revision:2};},reactivate:()=>{binding={...binding,active:true,revision:3};},changeCustomer:()=>{binding={...binding,customerIds:[],revision:2};}};
}
async function connect(f:ReturnType<typeof fixture>){const start=await f.adapter.begin(actor,connection);assert.ok(start.ok);if(!start.ok)throw Error();assert.equal((await f.adapter.callback(actor,connection,start.value.state,'synthetic-code')).ok,true);return start.value;}
test('PKCE state is hashed/encrypted, tenant-bound and consumed once',async()=>{
 const f=fixture(),start=await connect(f);assert.equal(f.exchanges(),1);assert.equal(f.states.size,0);assert.equal(f.verifier().length,43);assert.notEqual(start.challenge,f.verifier());
 assert.equal((await f.adapter.callback(actor,connection,start.state,'synthetic-code')).ok,false);assert.equal(f.exchanges(),1);assert.ok(!JSON.stringify([...f.vault.values()]).includes('synthetic-access'));
});
test('foreign principal/workspace cannot exchange or consume another tenant state',async()=>{
 const f=fixture(),start=await f.adapter.begin(actor,connection);assert.ok(start.ok);if(!start.ok)return;
 assert.equal((await f.adapter.begin({userId:other,workspaceId:other},connection)).ok,false);
 assert.equal((await f.adapter.callback({userId:other,workspaceId:other},connection,start.value.state,'code')).ok,false);
 assert.equal((await f.adapter.callback({...actor,workspaceId:other},connection,start.value.state,'code')).ok,false);assert.equal(f.exchanges(),0);assert.equal(f.states.size,1);
});
test('expired state and tokens deny without provider exchange/report',async()=>{
 const f=fixture(),start=await f.adapter.begin(actor,connection);assert.ok(start.ok);if(!start.ok)return;f.expire();assert.equal((await f.adapter.callback(actor,connection,start.value.state,'code')).ok,false);assert.equal(f.exchanges(),0);
 const g=fixture();await connect(g);g.expire();assert.equal((await g.adapter.campaignReport(actor,connection,'1234567890')).ok,false);assert.equal(g.reports(),0);
});
test('AES-GCM AAD rejects cross-tenant/connection/purpose substitution and tampering',()=>{
 const sealed=sealAdsEnvelope(key,user,connection,'tokens',{accessToken:'synthetic'});assert.deepEqual(openAdsEnvelope(key,user,connection,'tokens',sealed),{accessToken:'synthetic'});
 for(const args of [[other,connection,'tokens'],[user,other,'tokens'],[user,connection,'pkce']])assert.throws(()=>openAdsEnvelope(key,args[0],args[1],args[2],sealed));
 assert.throws(()=>openAdsEnvelope(key,user,connection,'tokens',{...sealed,tag:Buffer.alloc(16).toString('base64url')}));
});
test('server-bound account alone can issue fixed read query; int64 micros survive',async()=>{
 const f=fixture();await connect(f);assert.equal((await f.adapter.campaignReport(actor,connection,'9999999999')).ok,false);assert.equal(f.reports(),0);
 const result=await f.adapter.campaignReport(actor,connection,'1234567890');assert.ok(result.ok);if(result.ok)assert.equal(result.value.campaigns[0].costMicros,'9007199254740993');
 assert.match(f.query(),/^SELECT /);assert.match(f.query(),/LAST_7_DAYS ORDER BY campaign.id LIMIT 500$/);assert.doesNotMatch(f.query(),/INSERT|UPDATE|DELETE/);
});
test('revocation during exchange blocks storage; during report blocks result disclosure',async()=>{
 const f=fixture();f.provider.exchange=async()=>{f.revoke();return{accessToken:'synthetic',refreshToken:'synthetic',expiresAt:1010000};};
 const start=await f.adapter.begin(actor,connection);assert.ok(start.ok);if(start.ok)assert.equal((await f.adapter.callback(actor,connection,start.value.state,'code')).ok,false);assert.equal(f.vault.size,0);
 const g=fixture();await connect(g);g.provider.report=async()=>{g.changeCustomer();return[];};assert.equal((await g.adapter.campaignReport(actor,connection,'1234567890')).ok,false);
});
test('concurrent callbacks exchange once when injected store consumes atomically',async()=>{
 const f=fixture(),start=await f.adapter.begin(actor,connection);assert.ok(start.ok);if(!start.ok)return;
 const outcomes=await Promise.all([f.adapter.callback(actor,connection,start.value.state,'code'),f.adapter.callback(actor,connection,start.value.state,'code')]);assert.equal(outcomes.filter(x=>x.ok).length,1);assert.equal(f.exchanges(),1);
});
test('disabled adapter and provider errors reveal no sensitive exception',async()=>{
 const f=fixture(),disabled=new TenantAdsAdapter(f.repo,f.provider,key,{mode:'disabled',redirectUri});assert.deepEqual(await disabled.begin(actor,connection),{ok:false,reason:'disabled'});assert.equal(f.states.size,0);
 await connect(f);f.provider.report=async()=>{throw Error('synthetic-sensitive-token');};assert.deepEqual(await f.adapter.campaignReport(actor,connection,'1234567890'),{ok:false,reason:'unavailable'});
});
test('state from before revocation cannot redeem after binding reactivation',async()=>{
 const f=fixture(),start=await f.adapter.begin(actor,connection);assert.ok(start.ok);if(!start.ok)return;f.revoke();f.reactivate();assert.equal((await f.adapter.callback(actor,connection,start.value.state,'code')).ok,false);assert.equal(f.exchanges(),0);
});
test('provider deadline aborts without late persistence or secret errors',async()=>{
 const f=fixture();let signal:AbortSignal|undefined;f.provider.exchange=async input=>{signal=input.signal;return new Promise(()=>{});};
 const adapter=new TenantAdsAdapter(f.repo,f.provider,key,{mode:'offline-test',redirectUri,timeoutMs:5},()=>1000000),start=await adapter.begin(actor,connection);assert.ok(start.ok);if(!start.ok)return;
 assert.deepEqual(await adapter.callback(actor,connection,start.value.state,'code'),{ok:false,reason:'unavailable'});assert.equal(signal?.aborted,true);assert.equal(f.vault.size,0);
});

test('stale token ciphertext cannot be reused across a reconnect revision',async()=>{
 const f=fixture();await connect(f);f.revoke();f.reactivate();assert.deepEqual(await f.adapter.campaignReport(actor,connection,'1234567890'),{ok:false,reason:'unavailable'});assert.equal(f.reports(),0);
});
