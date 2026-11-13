import type {
  ApiFailureResponse,
  WordPressPairing,
  WordPressPairingResponse,
  WordPressInventory,
  WordPressInventoryResource,
  WordPressInventoryResponse,
  WordPressSite,
  WordPressSiteInspection,
  WordPressSiteInspectionResponse,
  WordPressControlledAction,
  WordPressControlledActionDetail,
  WordPressControlledActionDetailResponse,
  WordPressControlledActionListResponse,
  WordPressControlledActionResponse,
} from "../types/wordpress";
import { isSiteId, parseConnectedSites } from "./siteContract";
import { resolveApiBase } from "../lib/apiBase";

const API_BASE = `${resolveApiBase(import.meta.env.VITE_API_BASE_URL)}/wp-manager`;

export class ApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "ApiError";
  }
}

function authorizationHeaders(accessToken: string) {
  if (!accessToken) throw new ApiError("An authenticated session is required.", 401);
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };
}

async function responsePayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ApiError("The WordPress Manager service returned an invalid response.", response.status);
  }
}

function failureMessage(payload: unknown, fallback: string) {
  const message = (payload as ApiFailureResponse | null)?.message;
  return typeof message === "string" && message.length <= 240 ? message : fallback;
}

export async function getWordPressSites(
  accessToken: string,
  signal?: AbortSignal,
): Promise<WordPressSite[]> {
  const headers = authorizationHeaders(accessToken);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/sites`, {
      method: "GET",
      headers,
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("The sites service could not be reached. Check your connection and try again.");
  }

  if (response.status === 401) {
    throw new ApiError("Your session is no longer authorized. Please sign out and sign in again.", 401);
  }
  if (!response.ok) {
    throw new ApiError(`Unable to load connected sites (HTTP ${response.status}).`, response.status);
  }

  const payload = await responsePayload(response);
  try { return parseConnectedSites(payload); }
  catch { throw new ApiError("The sites service returned an invalid inventory. No totals are available."); }
}

export async function initiateWordPressPairing(
  accessToken: string,
  siteUrl: string,
): Promise<WordPressPairing> {
  const headers = authorizationHeaders(accessToken);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/pairing/initiate`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ site_url: siteUrl }),
    });
  } catch {
    throw new ApiError("The pairing service could not be reached. Check your connection and try again.");
  }

  const payload = await responsePayload(response);
  if (response.status === 401) {
    throw new ApiError("Your session is no longer authorized. Please sign out and sign in again.", 401);
  }
  if (!response.ok) {
    throw new ApiError(
      failureMessage(payload, "The pairing request could not be started."),
      response.status,
    );
  }

  const pairing = (payload as Partial<WordPressPairingResponse> | null)?.pairing;
  if (
    !pairing ||
    typeof pairing.connection_id !== "string" ||
    typeof pairing.site_url !== "string" ||
    typeof pairing.challenge !== "string" ||
    typeof pairing.expires_at !== "string"
  ) {
    throw new ApiError("The pairing service returned an unexpected response.");
  }

  return pairing;
}
export async function getWordPressSiteInspection(
  accessToken: string,
  connectionId: string,
): Promise<WordPressSiteInspection> {
  if (!isSiteId(connectionId)) {
    throw new ApiError("The connected site identifier is invalid.");
  }

  const headers = authorizationHeaders(accessToken);
  let response: Response;
  try {
    response = await fetch(
      `${API_BASE}/sites/${encodeURIComponent(connectionId)}/inspection`,
      {
        method: "GET",
        headers,
      },
    );
  } catch {
    throw new ApiError("The connected WordPress site could not be reached.");
  }

  const payload = await responsePayload(response);
  if (response.status === 401) {
    throw new ApiError("Your session is no longer authorized. Please sign out and sign in again.", 401);
  }
  if (!response.ok) {
    throw new ApiError(
      failureMessage(payload, "The connected WordPress site could not be inspected."),
      response.status,
    );
  }

  const inspection = (payload as Partial<WordPressSiteInspectionResponse> | null)?.inspection;
  if (
    !inspection ||
    typeof inspection !== "object" ||
    inspection.mode !== "read-only" ||
    typeof inspection.inspected_at !== "string" ||
    typeof inspection.site?.title !== "string" ||
    typeof inspection.identity?.site_id !== "string"
  ) {
    throw new ApiError("The inspection service returned an unexpected response.");
  }

  return inspection;
}

export async function getWordPressInventory(
  accessToken: string,
  connectionId: string,
  resource: WordPressInventoryResource,
  page = 1,
  perPage = 20,
): Promise<WordPressInventory> {
  if (!isSiteId(connectionId)) throw new ApiError("The connected site identifier is invalid.");
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(perPage) || perPage < 1 || perPage > 50) {
    throw new ApiError("The inventory page request is invalid.");
  }
  const query = resource === "plugins" ? "" : `?page=${page}&per_page=${perPage}`;
  const headers = authorizationHeaders(accessToken);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/sites/${encodeURIComponent(connectionId)}/${resource}${query}`, {
      method: "GET", headers,
    });
  } catch { throw new ApiError("The connected WordPress inventory could not be reached."); }
  const payload = await responsePayload(response);
  if (response.status === 401) throw new ApiError("Your session is no longer authorized. Please sign out and sign in again.", 401);
  if (!response.ok) throw new ApiError(failureMessage(payload, "The WordPress inventory could not be loaded."), response.status);
  const inventory = (payload as Partial<WordPressInventoryResponse> | null)?.inventory;
  if (!inventory || inventory.mode !== "read-only" || inventory.resource !== resource || !Array.isArray(inventory.items)) {
    throw new ApiError("The inventory service returned an unexpected response.");
  }
  return inventory;
}


const CONTROLLED_ACTION_STATUSES = new Set([
  "proposed", "approved", "executing", "succeeded", "failed", "expired", "cancelled",
]);

function controlledActionRecord(value: unknown): WordPressControlledAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("The controlled action service returned an unexpected response.");
  }
  const action = value as Record<string, unknown>;
  const uuid = isSiteId;
  const date = (field: unknown) =>
    typeof field === "string" && Number.isFinite(Date.parse(field));
  const nullableDate = (field: unknown) => field === null || date(field);
  let siteUrl: URL;
  try { siteUrl = new URL(String(action.site_url)); }
  catch { throw new ApiError("The controlled action site identity is invalid."); }
  if (
    !uuid(action.id) || !uuid(action.user_id) || !uuid(action.connection_id) || !uuid(action.site_id) ||
    siteUrl.protocol !== "https:" || siteUrl.username || siteUrl.password ||
    action.action_type !== "create_post_draft" ||
    typeof action.status !== "string" || !CONTROLLED_ACTION_STATUSES.has(action.status) ||
    typeof action.payload_digest !== "string" || action.payload_digest.length !== 64 || /[^0-9a-f]/i.test(action.payload_digest) ||
    (action.actor_source !== "user" && action.actor_source !== "approved_ai") ||
    !date(action.created_at) || !date(action.expires_at) ||
    !nullableDate(action.approved_at) || !nullableDate(action.executing_at) ||
    !nullableDate(action.execution_consumed_at) || !nullableDate(action.completed_at) ||
    !(action.result_post_id === null || (Number.isSafeInteger(action.result_post_id) && Number(action.result_post_id) > 0)) ||
    !(action.failure_code === null || (typeof action.failure_code === "string" && action.failure_code.length <= 64))
  ) {
    throw new ApiError("The controlled action service returned an unexpected response.");
  }
  return action as unknown as WordPressControlledAction;
}

function controlledActionDetail(value: unknown): WordPressControlledActionDetail {
  const action = controlledActionRecord(value);
  const payload = (value as { payload?: unknown }).payload;
  if (
    !payload || typeof payload !== "object" || Array.isArray(payload) ||
    Object.keys(payload).sort().join(",") !== "content,title" ||
    typeof (payload as Record<string, unknown>).title !== "string" ||
    typeof (payload as Record<string, unknown>).content !== "string"
  ) {
    throw new ApiError("The controlled action payload is unavailable or invalid.");
  }
  return { ...action, payload: payload as WordPressControlledActionDetail["payload"] };
}

async function controlledActionFetch(
  accessToken: string,
  path: string,
  method: "GET" | "POST" = "GET",
) {
  const headers = authorizationHeaders(accessToken);
  let response: Response;
  try {
    response = await fetch(API_BASE + path, { method, headers });
  } catch {
    throw new ApiError("The controlled action service could not be reached.");
  }
  const payload = await responsePayload(response);
  if (response.status === 401) {
    throw new ApiError("Your session is no longer authorized. Please sign out and sign in again.", 401);
  }
  if (response.status === 404) {
    throw new ApiError("Controlled action reviews are not enabled for this environment.", 404);
  }
  if (!response.ok) {
    throw new ApiError(failureMessage(payload, "The controlled action request could not be completed."), response.status);
  }
  return payload;
}

export async function getWordPressControlledActions(
  accessToken: string,
  connectionId: string,
): Promise<WordPressControlledAction[]> {
  if (!isSiteId(connectionId)) {
    throw new ApiError("The connected site identifier is invalid.");
  }
  const payload = await controlledActionFetch(
    accessToken,
    "/sites/" + encodeURIComponent(connectionId) + "/actions",
  );
  const actions = (payload as Partial<WordPressControlledActionListResponse> | null)?.actions;
  if (!Array.isArray(actions)) {
    throw new ApiError("The controlled action service returned an unexpected response.");
  }
  return actions.map(controlledActionRecord);
}

export async function getWordPressControlledAction(
  accessToken: string,
  actionId: string,
): Promise<WordPressControlledActionDetail> {
  if (!isSiteId(actionId)) throw new ApiError("The action identifier is invalid.");
  const payload = await controlledActionFetch(
    accessToken,
    "/actions/" + encodeURIComponent(actionId),
  );
  return controlledActionDetail(
    (payload as Partial<WordPressControlledActionDetailResponse> | null)?.action,
  );
}

async function transitionWordPressControlledAction(
  accessToken: string,
  actionId: string,
  transition: "approve" | "cancel",
): Promise<WordPressControlledAction> {
  if (!isSiteId(actionId)) throw new ApiError("The action identifier is invalid.");
  const payload = await controlledActionFetch(
    accessToken,
    "/actions/" + encodeURIComponent(actionId) + "/" + transition,
    "POST",
  );
  return controlledActionRecord(
    (payload as Partial<WordPressControlledActionResponse> | null)?.action,
  );
}

export function approveWordPressControlledAction(accessToken: string, actionId: string) {
  return transitionWordPressControlledAction(accessToken, actionId, "approve");
}

export function cancelWordPressControlledAction(accessToken: string, actionId: string) {
  return transitionWordPressControlledAction(accessToken, actionId, "cancel");
}
