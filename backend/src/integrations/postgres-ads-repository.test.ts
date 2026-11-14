import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresAdsRepository } from './postgres-ads-repository.js';
const user='10000000-0000-4000-8000-000000000001',connection='20000000-0000-4000-8000-000000000001';
const repo=new PostgresAdsRepository({async connect(){throw Error('Pool must not be called for invalid input');}});
test('repository identity and account validation rejects SQL-like input before persistence',async()=>{
 await assert.rejects(repo.binding(user,"'; DROP TABLE private.ads_connections;--"),/Invalid repository identity/);
 await assert.rejects(repo.rotateAccounts(user,connection,1,['1234567890 OR 1=1']),/Invalid account bindings/);
 await assert.rejects(repo.rotateAccounts(user,connection,1,['1234567890','1234567890']),/Invalid account bindings/);
});
test('plaintext/extra-key envelopes and invalid revisions never reach a database',async()=>{
 const envelope={version:1 as const,nonce:'A'.repeat(16),ciphertext:'A'.repeat(20),tag:'A'.repeat(22)};
 await assert.rejects(repo.saveTokensIfActive(user,connection,1,{...envelope,accessToken:'synthetic'} as typeof envelope),/Invalid encrypted envelope/);
 await assert.rejects(repo.saveTokensIfActive(user,connection,0,envelope),/Invalid connection revision/);
 await assert.rejects(repo.saveTokensIfActive(user,connection,1,{...envelope,ciphertext:'plaintext not base64'}),/Invalid encrypted envelope/);
});
