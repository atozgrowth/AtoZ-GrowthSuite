import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError } from "./api";
import { getDraftAvailability, inspectDraft, listDraftActions, proposeDraft, proposePublishDraft, transitionDraft, type DraftCapabilities } from "./draftApi";
import type { DraftAction, DraftStatus, ExistingDraft } from "./draftContract";

const labels: Record<DraftStatus, string> = {
  proposed: "Awaiting approval", approved: "Approved", executing: "Executing",
  succeeded: "Verified", failed: "Failed", uncertain: "Needs reconciliation",
  cancelled: "Cancelled", expired: "Expired",
};
type Message = { id: string; role: "user" | "assistant"; text: string };
function errorText(error: unknown) { return error instanceof ApiError || error instanceof Error ? error.message : "The WordPress assistant request could not be completed."; }

export function WordPressDraftPanel({ accessToken, connectionId, siteUrl, initialTargetId = "" }: {
  accessToken: string; connectionId: string; siteUrl: string; initialTargetId?: string;
}) {
  const [capabilities, setCapabilities] = useState<DraftCapabilities | null>(null);
  const [actions, setActions] = useState<DraftAction[]>([]);
  const [selected, setSelected] = useState<DraftAction | null>(null);
  const [instruction, setInstruction] = useState("");
  const [postType, setPostType] = useState<"post" | "page">("post");
  const [target, setTarget] = useState<ExistingDraft | null>(null);
  const [targetId, setTargetId] = useState(initialTargetId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [attemptedExecutions, setAttemptedExecutions] = useState<Set<string>>(() => new Set());
  const alive = useRef(true), lock = useRef(false), historyGeneration = useRef(0);

  useEffect(() => {
    alive.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { alive.current = false; clearInterval(timer); };
  }, []);
  useEffect(() => { if (initialTargetId) setTargetId(initialTargetId); }, [initialTargetId]);

  const refreshHistory = useCallback(async () => {
    const generation = ++historyGeneration.current;
    setHistoryLoading(true);
    try {
      const records = await listDraftActions(accessToken, connectionId);
      if (!alive.current || generation !== historyGeneration.current) return;
      setActions(records);
      setSelected((current) => current ? records.find((action) => action.id === current.id) ?? null : null);
    } catch (caught) {
      if (alive.current && generation === historyGeneration.current) setError(errorText(caught));
    } finally { if (alive.current && generation === historyGeneration.current) setHistoryLoading(false); }
  }, [accessToken, connectionId]);

  useEffect(() => {
    let active = true;
    historyGeneration.current++;
    setCapabilities(null); setSelected(null); setActions([]); setTarget(null); setMessages([]); setError(""); setAgreed(false);
    void getDraftAvailability(accessToken).then((value) => {
      if (active) { setCapabilities(value); if (value.enabled) void refreshHistory(); }
    }).catch(() => { if (active) setCapabilities({ enabled: false, provider: "unavailable", publishEnabled: false }); });
    return () => { active = false; };
  }, [accessToken, refreshHistory]);

  async function run(kind: string, operation: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(kind); setError(""); setNotice("");
    try { await operation(); }
    catch (caught) { if (alive.current) setError(errorText(caught)); }
    finally { lock.current = false; if (alive.current) setBusy(""); }
  }
  function remember(action: DraftAction) {
    if (!alive.current) return;
    historyGeneration.current++; setHistoryLoading(false); setSelected(action); setAgreed(false);
    setActions((current) => [action, ...current.filter((item) => item.id !== action.id)]);
  }
  function addMessage(role: Message["role"], text: string) {
    setMessages((current) => [...current, { id: `${Date.now()}-${current.length}`, role, text }]);
  }
  async function generate(event: FormEvent) {
    event.preventDefault();
    if (!capabilities?.enabled || !instruction.trim()) return;
    const request = instruction.trim();
    addMessage("user", request);
    await run("Generating an offline proposal", async () => {
      const action = await proposeDraft(accessToken, connectionId, {
        instruction: request, post_type: target?.type ?? postType,
        ...(target ? { post_id: target.id, expected_modified_gmt: target.modified_gmt, expected_content_digest: target.content_digest } : {}),
      });
      remember(action);
      addMessage("assistant", `Offline mock proposal ready for review: ${action.payload.title}. No WordPress change has happened.`);
      if (alive.current) { setInstruction(""); setNotice("This proposal came from the deterministic offline mock. It is not a live AI response and has not changed WordPress."); }
    });
  }
  async function loadTarget(event: FormEvent) {
    event.preventDefault();
    await run("Inspecting the selected draft", async () => {
      const draft = await inspectDraft(accessToken, connectionId, Number(targetId));
      if (!alive.current) return;
      setTarget(draft); setSelected(null); setAgreed(false);
      addMessage("user", `Inspect draft #${draft.id}`);
      addMessage("assistant", `Loaded unpublished ${draft.type} “${draft.title}”. Its current revision is bound to the next proposal.`);
      setNotice("This unpublished draft was read from the selected site. Editing or publishing requires a separate exact-content approval.");
    });
  }
  async function proposePublish() {
    if (!target || !capabilities?.publishEnabled) return;
    addMessage("user", `Publish draft #${target.id} after review`);
    await run("Preparing a publish proposal", async () => {
      const action = await proposePublishDraft(accessToken, connectionId, target);
      remember(action);
      addMessage("assistant", `Publishing proposal prepared for the existing content “${action.payload.title}”. No content was modified or published.`);
    });
  }

  const expired = selected ? Date.parse(selected.expires_at) <= now : false;
  const canApprove = selected?.status === "proposed" && !expired && agreed;
  const canExecute = selected?.status === "approved" && !expired && !attemptedExecutions.has(selected.id);
  const isPublish = selected?.action_type === "publish_draft";

  return <section className="panel draft-workflow-panel" aria-labelledby="draft-workflow-title" aria-busy={!!busy}>
    <div className="panel-heading"><div><h2 id="draft-workflow-title">WordPress AI assistant</h2><p>{siteUrl} · create and edit unpublished content with exact approval</p></div><span className={`status-pill ${capabilities?.enabled ? "pending" : "readonly"}`}>{capabilities?.enabled ? "Offline mock · isolated test" : "AI and writes unavailable"}</span></div>
    <div className="draft-workflow-body">
      {capabilities === null ? <p role="status">Checking server-controlled assistant availability…</p> : !capabilities.enabled ? <div className="readonly-banner"><div><strong>Assistant writes unavailable</strong><p>Content changes require an explicitly configured isolated test environment. Your live AI provider is not connected here; no paid request or live write is made.</p></div></div> : <>
        <div className="alert warning" role="note"><strong>Deterministic offline mock · no external AI calls</strong><p>Enter a post or page instruction. The adapter returns a bounded structured proposal; you preview and approve its exact payload before a separate, isolated WordPress action.</p></div>
        <div className="assistant-conversation" role="log" aria-label="WordPress assistant conversation" aria-live="polite">
          {messages.length === 0 ? <p className="assistant-welcome">Ask for a post or page draft. You can also inspect an unpublished draft and propose an edit or (only in the disposable test fixture) publishing.</p> : messages.map((message) => <article className={`assistant-message ${message.role}`} key={message.id}><strong>{message.role === "user" ? "You" : "A to Z assistant · offline mock"}</strong><p>{message.text}</p></article>)}
        </div>
        {error && <div className="alert error" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}{busy && <p role="status">{busy}…</p>}
        <div className="draft-editor-grid">
          <div>
            <form className="draft-instruction-form" onSubmit={generate}>
              <h3>{target ? `Edit existing ${target.type} draft #${target.id}` : "Create a post or page"}</h3>
              {target ? <><p>Current title: <strong>{target.title}</strong></p><details><summary>Inspect current draft content</summary><pre className="draft-content-preview">{target.content}</pre></details><button className="button secondary" type="button" disabled={!!busy} onClick={() => { setTarget(null); setSelected(null); setAgreed(false); }}>Return to new content</button></> : <label>Content type<select aria-label="Draft content type" value={postType} disabled={!!busy} onChange={(event) => { setPostType(event.target.value as "post" | "page"); setSelected(null); setAgreed(false); }}><option value="post">Blog post</option><option value="page">Page</option></select></label>}
              <label htmlFor="draft-instruction">What should the assistant create or change?</label><textarea id="draft-instruction" value={instruction} onChange={(event) => { setInstruction(event.target.value); setSelected(null); setAgreed(false); }} required maxLength={8000} rows={5} disabled={!!busy} placeholder="For example: Create an About Us page for a family-owned bakery."/><button className="button primary" disabled={!!busy || !instruction.trim()}>{busy === "Generating an offline proposal" ? "Preparing…" : "Prepare proposal"}</button>
            </form>
            <form className="draft-inspect-form" onSubmit={loadTarget}><h3>Inspect an existing draft</h3><p>Load an unpublished post or page by its ID. Published items remain read-only.</p><label htmlFor="existing-draft-id">WordPress draft ID</label><input id="existing-draft-id" type="number" min="1" step="1" value={targetId} onChange={(event) => setTargetId(event.target.value)} required disabled={!!busy}/><button className="button secondary" disabled={!!busy || !targetId}>Load draft for editing</button>{target && <button className="button secondary" type="button" disabled={!!busy || !capabilities.publishEnabled} onClick={() => void proposePublish()}>{capabilities.publishEnabled ? "Propose publishing this draft" : "Publishing is disabled outside the isolated test"}</button>}</form>
          </div>
          <div className="draft-preview" aria-labelledby="draft-preview-title"><h3 id="draft-preview-title">Exact proposal preview</h3>{selected ? <>
            <p><span className="status-pill readonly">{labels[selected.status]}</span> · {isPublish ? "Publish existing draft" : selected.action_type === "edit_draft" ? "Edit unpublished draft" : selected.action_type === "create_page_draft" ? "Create unpublished page" : "Create unpublished post"}</p>
            <dl><dt>Title</dt><dd><strong>{selected.payload.title}</strong></dd><dt>Content</dt><dd><pre className="draft-content-preview">{selected.payload.content}</pre></dd>{isPublish && <><dt>Target</dt><dd>{selected.payload.post_type} #{selected.payload.post_id}</dd></>}<dt>Approval expires</dt><dd>{new Date(selected.expires_at).toLocaleString()}</dd></dl>
            <p className="field-help">Content is displayed as escaped text. Approval is bound to this site and the exact server-held payload.</p>
            {selected.status === "proposed" && !expired && <><label className="draft-approval-check"><input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} disabled={!!busy}/>{isPublish ? "I reviewed this exact existing content and authorize publishing it on this site." : "I reviewed this exact title and content for this site."}</label><button className="button primary" disabled={!!busy || !canApprove} onClick={() => void run("Approving exact proposal", async () => { remember(await transitionDraft(accessToken, connectionId, selected, "approve")); if (alive.current) setNotice(isPublish ? "Exact publish proposal approved. The action is still separate and gated to the disposable fixture." : "Exact proposal approved. Choose Execute approved change to apply the isolated action."); })}>Approve exact proposal</button></>}
            {canExecute && <button className="button primary" disabled={!!busy} onClick={() => void run(isPublish ? "Publishing and verifying" : "Executing and verifying draft", async () => { setAttemptedExecutions((current) => new Set([...current, selected.id])); const result = await transitionDraft(accessToken, connectionId, selected, "execute"); remember(result); if (alive.current) setNotice(result.status === "succeeded" ? (isPublish ? `Published WordPress ${selected.payload.post_type} #${result.result_post_id} and independently verified its published status and content.` : `Unpublished draft #${result.result_post_id} created or updated and verified by readback.`) : "Execution did not reach verified success. Refresh activity and inspect the state before any further action."); })}>{busy ? "Working…" : isPublish ? "Execute approved publish" : "Execute approved change"}</button>}
            {(["uncertain", "executing"].includes(selected.status)) && <button className="button secondary" disabled={!!busy} onClick={() => void run("Verifying existing receipt", async () => { const result = await transitionDraft(accessToken, connectionId, selected, "reconcile"); remember(result); if (alive.current) setNotice(result.status === "succeeded" ? (isPublish ? "Existing publish receipt and WordPress readback verified. No new write was sent." : "Existing receipt and current draft verified. No new write was sent.") : "No verified receipt is available. Keep this action under reconciliation."); })}>Verify existing receipt</button>}
            {selected.status === "approved" && attemptedExecutions.has(selected.id) && <p role="alert">Execution was already requested in this view. Refresh activity to verify its state; do not submit it again automatically.</p>}
            {expired && ["proposed", "approved"].includes(selected.status) && <p role="alert">This approval expired. Generate and review a new proposal.</p>}
            {selected.status === "succeeded" && <p role="status">{isPublish ? `Published and verified WordPress content #${selected.result_post_id}.` : `Verified unpublished draft #${selected.result_post_id}. Nothing was published.`}</p>}
            {selected.status === "uncertain" && <p role="alert">Outcome uncertain. Do not retry automatically. Verify the existing receipt before another action.</p>}
            {selected.status === "expired" && <p role="alert">This approval expired and cannot be executed.</p>}{selected.status === "cancelled" && <p role="status">This proposal was cancelled and cannot be executed.</p>}{selected.status === "failed" && <p role="alert">Execution failed. Refresh activity and inspect the content before proposing another change.</p>}
          </> : <p>Enter a natural-language instruction, then inspect the exact proposal here before approval.</p>}</div>
        </div>
        <div className="panel-heading draft-history-heading"><div><h3>Activity history</h3><p>Server-owned proposals, approvals, execution results, and reconciliation.</p></div><button className="button secondary" disabled={!!busy || historyLoading} onClick={() => void refreshHistory()}>Refresh activity</button></div>
        {historyLoading ? <p role="status">Loading activity…</p> : actions.length ? <ol className="draft-history">{actions.map((action) => <li key={action.id}><button className="button secondary" onClick={() => { setSelected(action); setAgreed(false); setNotice(""); }} disabled={!!busy}><span>{action.payload.title}</span><small>{labels[action.status]} · {new Date(action.created_at).toLocaleString()}</small></button></li>)}</ol> : <p>No assistant actions recorded for this site.</p>}
      </>}
    </div>
  </section>;
}
