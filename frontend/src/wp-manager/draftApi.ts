import { ApiError } from './api';
import { resolveApiBase } from '../lib/apiBase';
import { isSiteId } from './siteContract';
import { parseDraftAction,parseExistingDraft,type DraftAction } from './draftContract';
const base=`${resolveApiBase(import.meta.env.VITE_API_BASE_URL)}/wp-manager`;
async function request(token:string,path:string,body?:unknown){
 if(!token)throw new ApiError('An authenticated session is required.',401);
 let response:Response;
 try{response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});}catch{throw new ApiError('Draft service could not be reached. Refresh activity before retrying an execution.');}
 let data:unknown;try{data=await response.json();}catch{throw new ApiError('The draft service returned an invalid response.',response.status);}
 if(!response.ok){if(response.status===401)throw new ApiError('Your session is no longer authorized. Sign in again.',401);if(response.status===404)throw new ApiError('Draft operations are unavailable in this environment.',404);if(response.status===409)throw new ApiError('This request cannot be repeated or the draft changed. Refresh activity and inspect its state.',409);throw new ApiError('The draft operation could not be verified. Refresh activity; do not automatically retry execution.',response.status);}
 if(!data||typeof data!=='object'||Array.isArray(data)||(data as {success?:unknown}).success!==true)throw new ApiError('The draft service returned an invalid response.');return data as Record<string,unknown>;
}
function requireConnection(id:string){if(!isSiteId(id))throw new ApiError('The connected site identifier is invalid.');}
export async function getDraftAvailability(token:string){const data=await request(token,'/drafts/status');return data.enabled===true&&data.provider==='offline'&&data.mode==='isolated-test-only';}
export async function listDraftActions(token:string,connectionId:string):Promise<DraftAction[]>{requireConnection(connectionId);const data=await request(token,`/sites/${connectionId}/drafts`);if(!Array.isArray(data.actions)||data.actions.length>100)throw new ApiError('The activity response is invalid.');const parsed=data.actions.map(a=>parseDraftAction(a,connectionId));if(new Set(parsed.map(a=>a.id)).size!==parsed.length)throw new ApiError('The activity response contains duplicate records.');return parsed;}
export async function proposeDraft(token:string,connectionId:string,body:{instruction:string;post_type:'post'|'page';post_id?:number;expected_modified_gmt?:string;expected_content_digest?:string}){requireConnection(connectionId);const data=await request(token,`/sites/${connectionId}/drafts/proposals`,body);return parseDraftAction(data.action,connectionId);}
export async function transitionDraft(token:string,connectionId:string,action:DraftAction,transition:'approve'|'execute'|'reconcile'){requireConnection(connectionId);if(!isSiteId(action.id)||action.connection_id!==connectionId)throw new ApiError('This proposal belongs to another site.');const data=await request(token,`/drafts/${action.id}/${transition}`,{payload_digest:action.payload_digest});return parseDraftAction(data.action,connectionId);}
export async function inspectDraft(token:string,connectionId:string,id:number){requireConnection(connectionId);if(!Number.isSafeInteger(id)||id<1)throw new ApiError('Enter a valid draft ID.');const data=await request(token,`/sites/${connectionId}/drafts/${id}`);return parseExistingDraft(data.draft,id);}
