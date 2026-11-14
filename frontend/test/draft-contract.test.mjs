import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDraftAction,parseExistingDraft} from '../src/wp-manager/draftContract.ts';
const connection='20000000-0000-4000-8000-000000000001';
const record={id:'40000000-0000-4000-8000-000000000001',connection_id:connection,site_id:'30000000-0000-4000-8000-000000000001',action_type:'create_post_draft',status:'proposed',payload_digest:'a'.repeat(64),payload:{title:'Synthetic draft',content:'<p>Text</p>'},created_at:'2026-01-01T12:00:00Z',expires_at:'2026-01-01T12:15:00Z',approved_at:null,completed_at:null,result_post_id:null,failure_code:null};
test('draft contracts accept supported types and require exact site binding',()=>{
 assert.equal(parseDraftAction(record,connection).payload.title,'Synthetic draft');assert.equal(parseDraftAction({...record,action_type:'create_page_draft'},connection).action_type,'create_page_draft');
 for(const bad of [{...record,connection_id:'20000000-0000-4000-8000-000000000002'},{...record,status:'published'},{...record,payload_digest:'x'.repeat(64)},{...record,payload:{...record.payload,approved:true}},{...record,action_type:'edit_draft'}])assert.throws(()=>parseDraftAction(bad,connection));
});
test('existing draft inspection rejects published content and changed targets',()=>{
 const draft={id:42,type:'post',status:'draft',title:'Synthetic',content:'<p>Text</p>',modified_gmt:'2026-01-01T12:00:00',content_digest:'b'.repeat(64)};assert.equal(parseExistingDraft(draft,42).id,42);
 for(const bad of [{...draft,id:43},{...draft,status:'publish'},{...draft,type:'attachment'},{...draft,content_digest:''}])assert.throws(()=>parseExistingDraft(bad,42));
 const payload={...record.payload,post_id:42,post_type:'post',expected_modified_gmt:draft.modified_gmt,expected_content_digest:draft.content_digest};assert.equal(parseDraftAction({...record,action_type:'edit_draft',payload},connection).payload.post_id,42);
});
