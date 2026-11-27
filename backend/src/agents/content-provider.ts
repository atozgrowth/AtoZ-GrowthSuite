/** Content proposals only. No HTTP route, key loading, approval or WordPress execution. */
import { randomUUID } from 'node:crypto';
import { runReadOnlyAgent, TransientReadError, type AuditEvent, type Principal } from './read-only-runner.js';
function deepFreeze<T extends object>(value:T):Readonly<T>{for(const child of Object.values(value))if(child&&typeof child==='object')deepFreeze(child);return Object.freeze(value);}
export const CONTENT_TOOL_SCHEMA = deepFreeze({
  name: 'wordpress.contentProposal', description: 'Generate title and plain-text paragraphs for a proposed unpublished post or page. Never approves or executes.',
  input: { type: 'object', additionalProperties: false, required: ['instruction','postType'], properties: { instruction: { type: 'string', minLength: 1, maxLength: 8000 }, postType: { type: 'string', enum: ['post','page'] } } },
  output: { type: 'object', additionalProperties: false, required: ['title','paragraphs'], properties: { title: { type: 'string', minLength: 1, maxLength: 200 }, paragraphs: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 4000 } } } },
} as const);
export type ContentBinding = Readonly<{ ownerId:string; workspaceId:string; connectionId:string; siteId:string; revision:number }>;
export type ContentLimits = Readonly<{
  maxInputTokens:number; maxOutputTokens:number; maxTotalTokens:number; maxAttempts:number; timeoutMs:number;
  maxCostMicros:string; inputMicrosPerMillionTokens:string; outputMicrosPerMillionTokens:string;
}>;
export type ContentRequest = Readonly<{ instruction:string; postType:'post'|'page'; maxInputTokens:number; maxOutputTokens:number }>;
export interface ContentModel { complete(request: ContentRequest, signal: AbortSignal): Promise<unknown> }
export class TransientContentError extends Error {}
export type ContentUsage = Readonly<{ executionId:string; attempt:number; reservedInputTokens:number; reservedOutputTokens:number; reservedCostMicros:string; reportedInputTokens?:number; reportedOutputTokens?:number }>;
export class ContentProposalError extends Error { constructor(public readonly code:'denied'|'failed'|'timed_out'){super('Content proposal could not be authorized or validated.');this.name='ContentProposalError';} }
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid response');return value as Record<string,unknown>;}
function exact(value:Record<string,unknown>,keys:string[]){if(Object.keys(value).sort().join(',')!==keys.sort().join(','))throw Error('Invalid fields');}
function positive(value:number,max:number){return Number.isSafeInteger(value)&&value>0&&value<=max;}
function decimal(value:string){if(!/^(?:0|[1-9]\d{0,17})$/.test(value))throw Error('Invalid budget');return BigInt(value);}
function escape(value:string){return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');}
function validateContent(raw:unknown,maxBytes:number){
  const root=object(raw);exact(root,['content','usage']);const content=object(root.content);exact(content,['title','paragraphs']);const usage=object(root.usage);exact(usage,['inputTokens','outputTokens']);
  // Detach selected properties once; untrusted getters/mutable objects never become approval payloads.
  const title=content.title, paragraphs=content.paragraphs, inputTokens=usage.inputTokens, outputTokens=usage.outputTokens;
  if(typeof title!=='string'||title!==title.trim()||!title||title.length>200||/[<>\u0000-\u001f]/.test(title)||!Array.isArray(paragraphs)||!paragraphs.length||paragraphs.length>20)throw Error('Invalid content');
  const copied=Array.from(paragraphs,p=>{if(typeof p!=='string'||!p.trim()||p.length>4000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(p))throw Error('Invalid paragraph');return p;});
  if(Buffer.byteLength(JSON.stringify({title,paragraphs:copied}))>maxBytes)throw Error('Output budget');
  if(!Number.isSafeInteger(inputTokens)||Number(inputTokens)<0||!Number.isSafeInteger(outputTokens)||Number(outputTokens)<0)throw Error('Invalid usage');
  return { title,content:copied.map(p=>'<p>'+escape(p)+'</p>').join('\n'),inputTokens:Number(inputTokens),outputTokens:Number(outputTokens) };
}
/** Cumulative reservations are process-local safety budgets, not durable billing/entitlements. */
export function createAuthorizedContentProvider(options:{
  principal:Principal; binding:ContentBinding; limits:ContentLimits; model:ContentModel;
  authorize:(binding:ContentBinding,signal:AbortSignal)=>Promise<boolean>;
  audit:(event:Readonly<AuditEvent>)=>void;
}){
  const binding=Object.freeze({...options.binding});
  const complete=options.model.complete.bind(options.model),authorize=options.authorize,audit=options.audit;
  const principal=Object.freeze({...options.principal,siteIds:Object.freeze([...options.principal.siteIds]),adsCustomerIds:Object.freeze([...options.principal.adsCustomerIds])});
  const limits=Object.freeze({...options.limits});
  if(!uuid.test(binding.ownerId)||!uuid.test(binding.connectionId)||!uuid.test(binding.siteId)||binding.ownerId!==principal.userId||binding.workspaceId!==principal.workspaceId||binding.workspaceId!==binding.ownerId||!principal.siteIds.includes(binding.siteId)||!positive(binding.revision,Number.MAX_SAFE_INTEGER))throw new ContentProposalError('denied');
  if(!positive(limits.maxInputTokens,32768)||!positive(limits.maxOutputTokens,8192)||!positive(limits.maxTotalTokens,1_000_000)||!positive(limits.maxAttempts,2)||!positive(limits.timeoutMs,30000))throw new ContentProposalError('denied');
  let maxCost:bigint,inputRate:bigint,outputRate:bigint;
  try{maxCost=decimal(limits.maxCostMicros);inputRate=decimal(limits.inputMicrosPerMillionTokens);outputRate=decimal(limits.outputMicrosPerMillionTokens);}catch{throw new ContentProposalError('denied');}
  const perAttemptCost=(BigInt(limits.maxInputTokens)*inputRate+BigInt(limits.maxOutputTokens)*outputRate+999999n)/1000000n;
  let tokensReserved=0,costReserved=0n;
  const usage:ContentUsage[]=[];
  return {
    async generate(input:{instruction:string;postType:'post'|'page'}):Promise<{title:string;content:string}>{
      if(!input||typeof input.instruction!=='string'||!input.instruction.trim()||input.instruction.length>8000||(input.postType!=='post'&&input.postType!=='page')||Object.keys(input).sort().join(',')!=='instruction,postType')throw new ContentProposalError('denied');
      const instruction=input.instruction,postType=input.postType;
      if(Buffer.byteLength(JSON.stringify({instruction,postType,schema:CONTENT_TOOL_SCHEMA}))>limits.maxInputTokens)throw new ContentProposalError('denied');
      const executionId=randomUUID();let attempts=0;
      const outcome=await runReadOnlyAgent({request:instruction,principal,timeoutMs:limits.timeoutMs,
        provider:{interpret:async()=>({tool:'wordpress.contentProposal',resourceId:binding.siteId})},
        adapters:{'wordpress.inventory':async()=>{throw Error('Unavailable');},'googleAds.campaignReport':async()=>{throw Error('Unavailable');},
          'wordpress.contentProposal':async(resource,signal)=>{
            if(resource!==binding.siteId||signal.aborted||!(await authorize(binding,signal))||signal.aborted)throw new ContentProposalError('denied');
            if(attempts>=limits.maxAttempts||tokensReserved+limits.maxInputTokens+limits.maxOutputTokens>limits.maxTotalTokens||costReserved+perAttemptCost>maxCost)throw new ContentProposalError('denied');
            // Synchronous reservation before await serializes concurrent calls in this instance.
            attempts++;tokensReserved+=limits.maxInputTokens+limits.maxOutputTokens;costReserved+=perAttemptCost;
            const record:ContentUsage={executionId,attempt:attempts,reservedInputTokens:limits.maxInputTokens,reservedOutputTokens:limits.maxOutputTokens,reservedCostMicros:perAttemptCost.toString()};
            usage.push(Object.freeze(record));
            let raw:unknown;
            try{raw=await complete(Object.freeze({instruction,postType,maxInputTokens:limits.maxInputTokens,maxOutputTokens:limits.maxOutputTokens}),signal);}
            catch(e){if(e instanceof TransientContentError&&attempts<limits.maxAttempts&&!signal.aborted)throw new TransientReadError('Transient generation failure');throw Error('Generation unavailable');}
            if(signal.aborted)throw Error('Deadline');
            const result=validateContent(raw,limits.maxOutputTokens);
            if(result.inputTokens>limits.maxInputTokens||result.outputTokens>limits.maxOutputTokens||!(await authorize(binding,signal))||signal.aborted)throw Error('Invalid generation');
            // Reported usage never releases the full reservation or changes authorization.
            usage[usage.indexOf(record)] = Object.freeze({...record,reportedInputTokens:result.inputTokens,reportedOutputTokens:result.outputTokens});
            return Object.freeze({title:result.title,content:result.content});
          }},audit});
      if(outcome.status!=='completed')throw new ContentProposalError(outcome.status==='denied'?'denied':outcome.status==='timed_out'?'timed_out':'failed');
      const result=object(outcome.result);exact(result,['title','content']);
      return Object.freeze({title:String(result.title),content:String(result.content)});
    },
    usage:()=>Object.freeze(usage.map(record=>Object.freeze({...record}))),
    budget:()=>Object.freeze({reservedTokens:tokensReserved,reservedCostMicros:costReserved.toString()}),
  };
}
