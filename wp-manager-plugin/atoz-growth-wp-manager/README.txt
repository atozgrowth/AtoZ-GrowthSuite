A to Z Growth Suite WordPress connector 0.5.0

Default behavior
----------------
Existing pairing, read-only inspection and metadata inventory remain available.
Unpublished draft operations are disabled by default. No publishing, scheduling,
plugin maintenance, shell, PHP or SQL endpoint is provided. This package does not
turn on production controlled writes.

Explicit isolated test configuration
------------------------------------
In a disposable WordPress container only, configure all of:

  define('WP_ENVIRONMENT_TYPE', 'local');
  define('ATOZ_GROWTH_ISOLATED_TEST_MODE', true);
  define('ATOZ_GROWTH_TEST_BACKEND_URL', 'http://backend:3000');
  define('ATOZ_GROWTH_TEST_WRITES_ENABLED', true);
  define('ATOZ_GROWTH_TEST_ACTOR_ID', 1); // Existing synthetic local editor/admin.

The actor ID is installation-specific, not a SaaS user or client-supplied role.
Only local/development WP environments and explicit loopback/backend service HTTP
origins on approved test ports are accepted. Missing/invalid configuration fails
closed and never falls back to the production API. Isolated mode also blocks all
WordPress HTTP requests outside that exact backend API prefix, including update
and cron-related outbound requests. Do not use this configuration on a live site.

Draft endpoints and boundaries
-----------------------------
POST /wp-json/atoz-growth/v1/drafts/execute accepts only create_post_draft,
create_page_draft or edit_draft. Backend permission must already be owner-checked,
explicitly approved, exact-payload-bound, expiring and single use. The plugin sends
its own persistent site identity and canonical digest to the backend and requires
literal authorization booleans and matching action ID/type/digest. A model cannot
supply approval. Safe HTML must be unchanged by WordPress wp_kses_post; otherwise
the request is rejected before any write. Local WordPress edit capabilities are
independently required.

GET /wp-json/atoz-growth/v1/drafts/<id> uses an independent post-bound one-use read
grant. It never returns published/private/pending content through this endpoint.
Title/content are raw display data; clients must escape text or use a reviewed
preview renderer, never execute them as instructions.

The canonical payload SHA256 is JSON in this order: title, content; edit adds
post_id, post_type, expected_modified_gmt, expected_content_digest. Slash and Unicode
characters are not escaped; Unicode line separators are preserved. Content digest
is SHA256 of canonical JSON {title,content}. The second digest prevents same-second
stale updates that a modified timestamp alone cannot detect.

Durability and recovery
-----------------------
A strict SQL INSERT IGNORE against the option_name unique key claims each action
before execution. WordPress add_option is not used for claims because its UPSERT
can succeed for two racing callers when their stored values differ. Receipts
store only operation/digest/connection/post ID/status, never grant tokens or full
content. Claimed actions are never automatically replayed, including when a
response is lost. Backend history/reconciliation must resolve uncertainty with a
new authorized read, not retry a write blindly. GET /drafts/receipts/<action-id>
requires a fresh exact action/type/digest grant before even looking up the local
receipt. Only a completed receipt for the current connection and an actual draft
is returned; incomplete/failed claims require manual reconciliation. Backend must
also compare exact approved content and independently read back the draft before
recording a successful recovered execution.

WordPress posts/options tables must both use InnoDB. Draft changes/readback/receipt
are transactional; editing additionally locks the post row FOR UPDATE and checks
both timestamp and content digest. This serializes cooperating connector edits
and prevents overwriting a concurrent core database update with stale content.
External side effects performed by other installed plugins/hooks are not promised
transactional rollback. Test fixtures should use a controlled plugin set.

An uncertain write stays reconciliation_required; no automatic delete or dangerous
rollback is attempted. A process crash may leave a post edit lock requiring a
privately reviewed manual reconciliation. Receipt/lock deletion is not exposed as
an unauthenticated API. Production retention/cleanup policy remains future work.

Reconnection
------------
Only a local administrator with a WordPress nonce may reset the local pairing
state. Permanent Site ID is retained. Revoke the previous backend connection first,
then obtain and explicitly confirm a fresh backend pairing challenge. Remote input
cannot silently reset or reassign a connected site.

Validation
----------
Standalone PHP fixtures are not proof of real WordPress integration. See the
repository's separate disposable WordPress/MySQL integration evidence and plugin
package manifest/checksums. No external WordPress site or production service is
validated by simply installing this package.
