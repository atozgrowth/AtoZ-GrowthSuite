import { isSiteId } from './siteContract.ts';
export type DraftStatus = 'proposed' | 'approved' | 'executing' | 'succeeded' | 'failed' | 'uncertain' | 'cancelled' | 'expired';
export type DraftPayload = { title: string; content: string; post_id?: number; post_type?: 'post' | 'page'; expected_modified_gmt?: string; expected_content_digest?: string };
export type DraftAction = { id: string; connection_id: string; site_id: string; action_type: 'create_post_draft' | 'create_page_draft' | 'edit_draft'; status: DraftStatus; payload_digest: string; payload: DraftPayload; created_at: string; expires_at: string; approved_at: string | null; completed_at: string | null; result_post_id: number | null; failure_code: string | null };
export type ExistingDraft = { id: number; type: 'post' | 'page'; status: 'draft'; title: string; content: string; modified_gmt: string; content_digest: string };
const statuses = new Set(['proposed','approved','executing','succeeded','failed','uncertain','cancelled','expired']);
const actions = new Set(['create_post_draft','create_page_draft','edit_draft']);
const validDate = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const nullableDate = (v: unknown) => v === null || validDate(v);
const positiveId = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
export function parseDraftAction(value: unknown, connectionId: string): DraftAction {
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid draft action response.');
 const a=value as Record<string,unknown>;const p=a.payload as Record<string,unknown>|undefined;
 if(!isSiteId(a.id)||a.connection_id!==connectionId||!isSiteId(a.site_id)||!actions.has(String(a.action_type))||!statuses.has(String(a.status))||typeof a.payload_digest!=='string'||!/^[0-9a-f]{64}$/.test(a.payload_digest)||!p||typeof p!=='object'||Array.isArray(p)||typeof p.title!=='string'||p.title.length>200||typeof p.content!=='string'||p.content.length>100000||!validDate(a.created_at)||!validDate(a.expires_at)||!nullableDate(a.approved_at)||!nullableDate(a.completed_at)||!(a.result_post_id===null||positiveId(a.result_post_id))||!(a.failure_code===null||(typeof a.failure_code==='string'&&a.failure_code.length<=80)))throw Error('Invalid or mismatched draft action response.');
 if(Object.keys(p).some(key=>!['title','content','post_id','post_type','expected_modified_gmt','expected_content_digest'].includes(key))||(p.post_type!==undefined&&p.post_type!=='post'&&p.post_type!=='page')||(p.post_id!==undefined&&!positiveId(p.post_id))||(p.expected_modified_gmt!==undefined&&typeof p.expected_modified_gmt!=='string')||(p.expected_content_digest!==undefined&&(typeof p.expected_content_digest!=='string'||!/^[0-9a-f]{64}$/.test(p.expected_content_digest))))throw Error('Invalid draft payload response.');
 if(a.action_type==='edit_draft'&&(!positiveId(p.post_id)||typeof p.expected_modified_gmt!=='string'||!p.expected_modified_gmt||typeof p.expected_content_digest!=='string'))throw Error('The edit target is unavailable.');
 return a as unknown as DraftAction;
}
export function parseExistingDraft(value:unknown,id:number):ExistingDraft {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid draft inspection response.');
 const d=value as Record<string,unknown>;
 if(d.id!==id||!positiveId(d.id)||!['post','page'].includes(String(d.type))||d.status!=='draft'||typeof d.title!=='string'||d.title.length>200||typeof d.content!=='string'||d.content.length>100000||typeof d.modified_gmt!=='string'||!d.modified_gmt||d.modified_gmt.length>64||typeof d.content_digest!=='string'||!/^[0-9a-f]{64}$/.test(d.content_digest))throw Error('Only the requested unpublished draft can be inspected.');
 return d as ExistingDraft;
}
