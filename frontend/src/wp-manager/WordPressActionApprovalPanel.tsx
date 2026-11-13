import { useCallback, useEffect, useRef, useState } from "react";
import type {
  WordPressControlledAction,
  WordPressControlledActionDetail,
  WordPressControlledActionStatus,
} from "../types/wordpress";
import {
  ApiError,
  approveWordPressControlledAction,
  cancelWordPressControlledAction,
  getWordPressControlledAction,
  getWordPressControlledActions,
} from "./api";

type Props = {
  accessToken: string;
  connectionId: string;
  siteUrl: string;
};

type Mutation = "approve" | "cancel";

const STATUS_LABELS: Record<WordPressControlledActionStatus, string> = {
  proposed: "Awaiting approval",
  approved: "Approved",
  executing: "Executing",
  succeeded: "Succeeded",
  failed: "Failed",
  expired: "Expired",
  cancelled: "Cancelled",
};

function isPastExpiry(expiresAt: string, now: number) {
  return new Date(expiresAt).getTime() <= now;
}

function effectiveStatus(
  action: WordPressControlledAction,
  now: number,
): WordPressControlledActionStatus {
  if (
    (action.status === "proposed" || action.status === "approved") &&
    isPastExpiry(action.expires_at, now)
  ) {
    return "expired";
  }

  return action.status;
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function sameSite(left: string, right: string) {
  try {
    return new URL(left).toString().replace(/\/$/, "") ===
      new URL(right).toString().replace(/\/$/, "");
  } catch {
    return false;
  }
}

function statusClass(status: WordPressControlledActionStatus) {
  if (status === "proposed") return "pending";
  if (status === "expired" || status === "failed" || status === "cancelled") {
    return "expired";
  }
  if (status === "approved" || status === "succeeded") return "success";
  return "readonly";
}

export function WordPressActionApprovalPanel({
  accessToken,
  connectionId,
  siteUrl,
}: Props) {
  const [actions, setActions] = useState<WordPressControlledAction[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WordPressControlledActionDetail | null>(
    null,
  );
  const [loadingActions, setLoadingActions] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mutation, setMutation] = useState<Mutation | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);
  const mutationLock = useRef(false);

  useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const loadActions = useCallback(async () => {
    setLoadingActions(true);
    setError(null);
    try {
      const response = await getWordPressControlledActions(
        accessToken,
        connectionId,
      );
      if (!mounted.current) return;
      setActions(response);
      setSelectedId((current) => {
        if (current && response.some((action) => action.id === current)) {
          return current;
        }
        return response[0]?.id ?? null;
      });
    } catch (caught) {
      if (!mounted.current) return;
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not load controlled action requests.",
      );
      setActions([]);
      setSelectedId(null);
    } finally {
      if (mounted.current) setLoadingActions(false);
    }
  }, [accessToken, connectionId]);

  useEffect(() => {
    void loadActions();
  }, [loadActions]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }

    let active = true;
    setLoadingDetail(true);
    setError(null);

    void getWordPressControlledAction(accessToken, selectedId)
      .then((response) => {
        if (!active) return;
        if (
          response.connection_id !== connectionId ||
          !sameSite(response.site_url, siteUrl)
        ) {
          throw new ApiError(
            "The selected action does not belong to this connected site.",
          );
        }
        setDetail(response);
      })
      .catch((caught) => {
        if (!active) return;
        setDetail(null);
        setError(
          caught instanceof ApiError
            ? caught.message
            : "Could not load the action request details.",
        );
      })
      .finally(() => {
        if (active) setLoadingDetail(false);
      });

    return () => {
      active = false;
    };
  }, [accessToken, connectionId, selectedId, siteUrl]);

  const runMutation = async (kind: Mutation) => {
    if (!detail || mutationLock.current) return;

    const status = effectiveStatus(detail, Date.now());
    const permitted =
      kind === "approve"
        ? status === "proposed"
        : status === "proposed" || status === "approved";
    if (!permitted) return;

    mutationLock.current = true;
    setMutation(kind);
    setError(null);
    setNotice(null);

    try {
      const response =
        kind === "approve"
          ? await approveWordPressControlledAction(accessToken, detail.id)
          : await cancelWordPressControlledAction(accessToken, detail.id);

      if (!mounted.current) return;
      setDetail((current) =>
        current?.id === response.id
          ? { ...current, ...response }
          : current,
      );
      setActions((current) =>
        current.map((action) =>
          action.id === response.id ? response : action,
        ),
      );
      setNotice(
        kind === "approve"
          ? "Proposal approved. No WordPress post was created; execution is unavailable in Phase 1."
          : "Proposal cancelled. It cannot be approved or executed.",
      );
    } catch (caught) {
      if (!mounted.current) return;
      setError(
        caught instanceof ApiError
          ? caught.message
          : `Could not ${kind} this action request.`,
      );
    } finally {
      mutationLock.current = false;
      if (mounted.current) setMutation(null);
    }
  };

  const selectedStatus = detail ? effectiveStatus(detail, now) : null;
  const canApprove = selectedStatus === "proposed";
  const canCancel =
    selectedStatus === "proposed" || selectedStatus === "approved";

  return (
    <section className="panel action-approval-panel" aria-labelledby="action-approval-title">
      <div className="panel-heading">
        <div>
          <h2 id="action-approval-title">Draft post approvals</h2>
          <p>Review owner approvals for this connected WordPress site.</p>
        </div>
        <span className="status-pill readonly">
          <i /> Phase 1 only
        </span>
      </div>

      <div className="action-safety-banner" role="note">
        <strong>Approval does not write to WordPress.</strong>
        <p>
          This phase records approval intent only. Draft creation, publishing,
          editing, deletion, uploads, and every other WordPress mutation remain
          unavailable.
        </p>
      </div>

      {error && actions.length > 0 ? <div className="alert error" role="alert">{error}</div> : null}
      {notice ? <div className="alert success" role="status">{notice}</div> : null}

      {loadingActions ? (
        <div className="state-box">
          <span className="spinner" aria-hidden="true" />
          <h3>Loading approval requests</h3>
          <p>Retrieving the action requests owned by your account.</p>
        </div>
      ) : error && actions.length === 0 ? (
        <div className="state-box error-state">
          <span className="state-icon" aria-hidden="true">!</span>
          <h3>Approval requests unavailable</h3>
          <p role="alert">{error}</p>
          <button className="button secondary" type="button" onClick={() => void loadActions()}>
            Try again
          </button>
        </div>
      ) : actions.length === 0 ? (
        <div className="state-box">
          <span className="state-icon site" aria-hidden="true">✓</span>
          <h3>No draft proposals</h3>
          <p>There are no create-post-as-draft requests to review for this site.</p>
        </div>
      ) : (
        <div className="action-review-layout">
          <nav className="action-request-list" aria-label="Draft post proposals">
            {actions.map((action) => {
              const status = effectiveStatus(action, now);
              return (
                <button
                  className={`action-request-item${selectedId === action.id ? " selected" : ""}`}
                  key={action.id}
                  type="button"
                  onClick={() => {
                    setNotice(null);
                    setSelectedId(action.id);
                  }}
                  aria-current={selectedId === action.id ? "true" : undefined}
                >
                  <span>Draft post proposal</span>
                  <small>{formatTimestamp(action.created_at)}</small>
                  <span className={`status-pill ${statusClass(status)}`}>
                    {STATUS_LABELS[status]}
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="action-review-detail">
            {loadingDetail ? (
              <div className="action-inline-state">
                <span className="spinner" aria-hidden="true" />
                <span>Loading exact proposal details…</span>
              </div>
            ) : detail && selectedStatus ? (
              <>
                <div className="action-detail-heading">
                  <div>
                    <span className="eyebrow">Create post as draft</span>
                    <h3>{detail.payload.title}</h3>
                  </div>
                  <span className={`status-pill ${statusClass(selectedStatus)}`}>
                    {STATUS_LABELS[selectedStatus]}
                  </span>
                </div>

                <dl className="action-detail-grid">
                  <div>
                    <dt>Connected site</dt>
                    <dd>{detail.site_url}</dd>
                  </div>
                  <div>
                    <dt>Forced status</dt>
                    <dd><strong>Draft</strong></dd>
                  </div>
                  <div>
                    <dt>Expires</dt>
                    <dd>{formatTimestamp(detail.expires_at)}</dd>
                  </div>
                  <div>
                    <dt>Action state</dt>
                    <dd>{STATUS_LABELS[selectedStatus]}</dd>
                  </div>
                  <div>
                    <dt>Action ID</dt>
                    <dd className="mono">{detail.id}</dd>
                  </div>
                  <div>
                    <dt>Proposed</dt>
                    <dd>{formatTimestamp(detail.created_at)}</dd>
                  </div>
                </dl>

                <div className="action-payload-field">
                  <span>Proposed title</span>
                  <strong>{detail.payload.title}</strong>
                </div>

                <div className="action-payload-field">
                  <span>Exact proposed content</span>
                  <small>
                    Displayed as text for review. React escaping remains active.
                  </small>
                  <pre>{detail.payload.content}</pre>
                </div>

                {selectedStatus === "expired" ? (
                  <div className="alert warning action-warning">
                    This proposal has expired and can no longer be approved or cancelled.
                  </div>
                ) : selectedStatus === "cancelled" ? (
                  <div className="alert warning action-warning">
                    This proposal was cancelled and cannot be approved or executed.
                  </div>
                ) : selectedStatus === "approved" ? (
                  <div className="alert success action-warning">
                    Owner approval is recorded. No WordPress execution is available.
                  </div>
                ) : selectedStatus === "proposed" ? (
                  <div className="alert warning action-warning">
                    Approve only if the site, title, and exact content above are correct.
                    Approval records intent; it does not create or publish a post.
                  </div>
                ) : null}

                <div className="action-approval-controls">
                  {canApprove ? (
                    <button
                      className="button primary"
                      type="button"
                      disabled={mutation !== null}
                      onClick={() => void runMutation("approve")}
                    >
                      {mutation === "approve" ? "Approving…" : "Approve draft proposal"}
                    </button>
                  ) : null}
                  {canCancel ? (
                    <button
                      className="button secondary"
                      type="button"
                      disabled={mutation !== null}
                      onClick={() => void runMutation("cancel")}
                    >
                      {mutation === "cancel" ? "Cancelling…" : "Cancel proposal"}
                    </button>
                  ) : null}
                  {!canApprove && !canCancel ? (
                    <span className="action-no-controls">
                      No owner action is available in this state.
                    </span>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="action-inline-state">
                Select a proposal to review its exact details.
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
