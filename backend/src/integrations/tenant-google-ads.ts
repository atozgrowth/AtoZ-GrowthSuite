/** Offline-only integration contract: no router, live transport or credential loading. */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { parseCampaignReport, type CampaignReport } from './google-ads-report.js';
export type AdsActor = Readonly<{ userId:string; workspaceId:string }>;
export type AdsBinding = Readonly<{ userId:string; connectionId:string; revision:number; active:boolean; customerIds:readonly string[] }>;
export type AdsTokens = { accessToken:string; refreshToken:string; expiresAt:number };
export type AdsEnvelope = { version:1; nonce:string; ciphertext:string; tag:string };
export type AdsState = { digest:string; userId:string; connectionId:string; bindingRevision:number; redirectUri:string; expiresAt:number; verifier:AdsEnvelope };
export interface AdsRepository {
  /** Authoritative owner lookup, never client/model claims or headers. */
  binding(userId:string,connectionId:string):Promise<AdsBinding|null>;
  createState(record:AdsState):Promise<void>;
  /** Atomic one-use compare/consume across workers; match all input fields + expiry. */
  consumeState(input:{digest:string;userId:string;connectionId:string;bindingRevision:number;redirectUri:string;now:number}):Promise<AdsState|null>;
  /** Atomic active owner/revision check + encrypted write; false after revocation. */
  saveTokensIfActive(userId:string,connectionId:string,revision:number,envelope:AdsEnvelope):Promise<boolean>;
  /** Atomic active owner/revision check + read; envelope is revision-bound. */
  loadTokens(userId:string,connectionId:string,revision:number):Promise<AdsEnvelope|null>;
}
export interface AdsProvider {
  exchange(input:{code:string;verifier:string;redirectUri:string;signal:AbortSignal}):Promise<AdsTokens>;
  report(input:{customerId:string;accessToken:string;query:string;signal:AbortSignal}):Promise<unknown>;
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const aad=(user:string,connection:string,purpose:string)=>Buffer.from(JSON.stringify(['atoz-ads',1,user,connection,purpose]));
export function sealAdsEnvelope(key:Uint8Array,user:string,connection:string,purpose:string,value:unknown):AdsEnvelope {
  if(key.byteLength!==32)throw Error('Invalid vault key');
  const clear=JSON.stringify(value);if(!clear||Buffer.byteLength(clear)>16384)throw Error('Invalid vault payload');
  const nonce=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(aad(user,connection,purpose));
  return {version:1,nonce:nonce.toString('base64url'),ciphertext:Buffer.concat([cipher.update(clear),cipher.final()]).toString('base64url'),tag:cipher.getAuthTag().toString('base64url')};
}
export function openAdsEnvelope(key:Uint8Array,user:string,connection:string,purpose:string,envelope:AdsEnvelope):unknown {
  if(key.byteLength!==32||envelope.version!==1||envelope.ciphertext.length>22000)throw Error('Invalid vault envelope');
  const nonce=Buffer.from(envelope.nonce,'base64url'),tag=Buffer.from(envelope.tag,'base64url');
  if(nonce.length!==12||tag.length!==16)throw Error('Invalid vault envelope');
  const decipher=createDecipheriv('aes-256-gcm',key,nonce);decipher.setAAD(aad(user,connection,purpose));decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64url')),decipher.final()]).toString('utf8'));
}
const QUERY='SELECT campaign.id, campaign.name, campaign.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date DURING LAST_7_DAYS ORDER BY campaign.id LIMIT 500';
export type BoundedCampaignReport={campaigns:CampaignReport[];maxRows:500;period:'LAST_7_DAYS';complete:false};
export type AdsResult<T>={ok:true;value:T}|{ok:false;reason:'disabled'|'denied'|'unavailable'};
type Config={mode:'disabled'|'offline-test';redirectUri:string;timeoutMs?:number};
export class TenantAdsAdapter {
  private readonly key:Buffer;
  private readonly config:Readonly<Config>;
  constructor(private readonly repo:AdsRepository,private readonly provider:AdsProvider,key:Uint8Array,config:Config,private readonly now=()=>Date.now()) {
    this.key=Buffer.from(key);this.config=Object.freeze({...config});const redirect=new URL(config.redirectUri);
    if(this.key.length!==32||redirect.protocol!=='https:'||redirect.username||redirect.password||redirect.hash||redirect.search)throw Error('Invalid adapter configuration');
    if(!Number.isInteger(config.timeoutMs??3000)||(config.timeoutMs??3000)<1||(config.timeoutMs??3000)>30000)throw Error('Invalid deadline');
  }
  private async call<T>(fn:(signal:AbortSignal)=>Promise<T>):Promise<T> {
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([Promise.resolve().then(()=>fn(controller.signal)),new Promise<T>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Provider deadline'));},this.config.timeoutMs??3000);})]);}
    finally{if(timer)clearTimeout(timer);controller.abort();}
  }
  private async own(actor:AdsActor,connectionId:string):Promise<AdsBinding|null> {
    if(!UUID.test(actor.userId)||actor.workspaceId!==actor.userId||!UUID.test(connectionId))return null;
    const binding=await this.repo.binding(actor.userId,connectionId);
    if(!binding||!binding.active||binding.userId!==actor.userId||binding.connectionId!==connectionId||!Number.isSafeInteger(binding.revision)||binding.revision<1)return null;
    return Object.freeze({...binding,customerIds:Object.freeze([...binding.customerIds])});
  }
  async begin(actorInput:AdsActor,connectionId:string):Promise<AdsResult<{state:string;challenge:string;redirectUri:string}>> {
    const actor=Object.freeze({...actorInput});if(this.config.mode!=='offline-test')return{ok:false,reason:'disabled'};
    try{const binding=await this.own(actor,connectionId);if(!binding)return{ok:false,reason:'denied'};
      const state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
      await this.repo.createState({digest:digest(state),userId:actor.userId,connectionId,bindingRevision:binding.revision,redirectUri:this.config.redirectUri,expiresAt:this.now()+300000,verifier:sealAdsEnvelope(this.key,actor.userId,connectionId,'pkce',verifier)});
      return{ok:true,value:{state,challenge:createHash('sha256').update(verifier).digest('base64url'),redirectUri:this.config.redirectUri}};
    }catch{return{ok:false,reason:'unavailable'};}
  }
  async callback(actorInput:AdsActor,connectionId:string,state:string,code:string):Promise<AdsResult<null>> {
    const actor=Object.freeze({...actorInput});if(this.config.mode!=='offline-test')return{ok:false,reason:'disabled'};
    try{const binding=await this.own(actor,connectionId);
      if(!binding||!/^[A-Za-z0-9_-]{43}$/.test(state)||typeof code!=='string'||!code||code.length>2048)return{ok:false,reason:'denied'};
      const row=await this.repo.consumeState({digest:digest(state),userId:actor.userId,connectionId,bindingRevision:binding.revision,redirectUri:this.config.redirectUri,now:this.now()});
      if(!row||row.bindingRevision!==binding.revision||row.userId!==actor.userId||row.connectionId!==connectionId||row.redirectUri!==this.config.redirectUri||row.expiresAt<=this.now()||row.digest!==digest(state))return{ok:false,reason:'denied'};
      const verifier=openAdsEnvelope(this.key,actor.userId,connectionId,'pkce',row.verifier);
      if(typeof verifier!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(verifier))throw Error('Invalid verifier');
      const tokens=await this.call(signal=>this.provider.exchange({code,verifier,redirectUri:this.config.redirectUri,signal}));
      if(!tokens||typeof tokens.accessToken!=='string'||!tokens.accessToken||tokens.accessToken.length>8192||typeof tokens.refreshToken!=='string'||!tokens.refreshToken||tokens.refreshToken.length>8192||!Number.isFinite(tokens.expiresAt)||tokens.expiresAt<=this.now())throw Error('Invalid tokens');
      const saved=await this.repo.saveTokensIfActive(actor.userId,connectionId,binding.revision,sealAdsEnvelope(this.key,actor.userId,connectionId,'tokens:'+binding.revision,tokens));
      return saved?{ok:true,value:null}:{ok:false,reason:'denied'};
    }catch{return{ok:false,reason:'unavailable'};}
  }
  async campaignReport(actorInput:AdsActor,connectionId:string,customerId:string):Promise<AdsResult<BoundedCampaignReport>> {
    const actor=Object.freeze({...actorInput});if(this.config.mode!=='offline-test')return{ok:false,reason:'disabled'};
    try{const binding=await this.own(actor,connectionId);
      if(!binding||!/^\d{10}$/.test(customerId)||!binding.customerIds.includes(customerId))return{ok:false,reason:'denied'};
      const envelope=await this.repo.loadTokens(actor.userId,connectionId,binding.revision);if(!envelope)return{ok:false,reason:'denied'};
      const tokens=openAdsEnvelope(this.key,actor.userId,connectionId,'tokens:'+binding.revision,envelope) as AdsTokens;
      if(typeof tokens.accessToken!=='string'||!tokens.accessToken||!Number.isFinite(tokens.expiresAt)||tokens.expiresAt<=this.now())return{ok:false,reason:'denied'};
      const rows=await this.call(signal=>this.provider.report({customerId,accessToken:tokens.accessToken,query:QUERY,signal}));
      const current=await this.own(actor,connectionId);
      if(!current||current.revision!==binding.revision||!current.customerIds.includes(customerId))return{ok:false,reason:'denied'};
      return{ok:true,value:{campaigns:parseCampaignReport(rows),maxRows:500,period:'LAST_7_DAYS',complete:false}};
    }catch{return{ok:false,reason:'unavailable'};}
  }
}
