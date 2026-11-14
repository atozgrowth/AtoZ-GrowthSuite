# WordPress workspace integration

The draft workspace uses server-controlled `/api/wp-manager/drafts/status`. Controls appear only when `enabled === true`, provider is `offline` and mode is `isolated-test-only`. Other environments show an unavailable explanation; inventory remains read-only. A frontend flag never enables backend writes.

Site selection keys the workspace, resets proposal context and guards late inspection responses. Theme inventory uses the implemented `/sites/:connectionId/themes` contract and distinguishes unknown/stale cache state. Connection revocation requires explicit confirmation and a verified backend response.

The draft UI sends instructions for post/page or an inspected unpublished draft target. Edits bind both modified timestamp and content digest. Title/content previews render as escaped text, not HTML. An explicit checkbox precedes exact-payload approval; execution is a separate button. No automatic execution retry occurs. Once an execution is requested in this view, the button stays unavailable for that action in this view; refreshing displays server state, and uncertainty requires reconciliation. For uncertain/executing records, an explicit Verify existing receipt action requests read-only receipt/readback reconciliation. It never retries a write; only a server-verified result is labelled success. No publishing, deletion or unrestricted action is exposed.

`e2e/wordpress-workflow.spec.ts` uses intercepted synthetic API/Auth responses; these browser cases demonstrate UI contracts, not actual WordPress core integration. Actual isolated WordPress tests are separate. Desktop/mobile screenshot files 08/09 are included in the nine-screen artifact index. No real credentials or external site are used.
