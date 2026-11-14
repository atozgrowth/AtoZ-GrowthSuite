export interface WordPressSite { status?: unknown; id?: string | number; site_url: string; created_at?: string; [key: string]: unknown }
export interface WordPressSitesResponse { sites: WordPressSite[] }

export interface WordPressPairing {
  connection_id: string;
  site_url: string;
  challenge: string;
  expires_at: string;
}

export interface WordPressPairingResponse {
  success: true;
  pairing: WordPressPairing;
}

export interface ApiFailureResponse {
  success?: false;
  message?: string;
}
export interface WordPressSiteInspection {
  identity: {
    site_id: string;
    site_url: string;
  };
  mode: "read-only";
  inspected_at: string;
  site: {
    title: string;
    description: string;
    url: string;
    wordpress_version: string;
    php_version: string;
    language: string;
    timezone: string;
    multisite: boolean;
    https: boolean;
  };
  theme: {
    name: string;
    version: string;
    stylesheet: string;
    parent: string | null;
  };
  plugins: {
    total: number;
    active: number;
    inactive: number;
    network_active: number;
  };
  content: {
    posts: number;
    pages: number;
    media: number;
  };
}

export interface WordPressSiteInspectionResponse {
  success: true;
  inspection: WordPressSiteInspection;
}

export type WordPressInventoryResource = "posts" | "pages" | "media" | "plugins" | "themes";
export interface WordPressInventoryPagination { page: number; per_page: number; total_items: number; total_pages: number }
export interface WordPressContentInventoryItem {
  id: number; title: string; status: string; author_display_name: string | null;
  published_at: string | null; modified_at: string | null; slug: string; public_url: string | null;
}
export interface WordPressMediaInventoryItem {
  id: number; title: string; media_type: string; mime_type: string;
  width: number | null; height: number | null; uploaded_at: string | null; public_url: string;
}
export interface WordPressThemeInventoryItem { name: string; version: string; active: boolean; parent: string | null; update_available: boolean | null }
export interface WordPressPluginInventoryItem { name: string; version: string; active: boolean }
export interface WordPressInventory {
  identity: { site_id: string; site_url: string };
  mode: "read-only";
  resource: WordPressInventoryResource;
  pagination?: WordPressInventoryPagination;
  items: Array<WordPressContentInventoryItem | WordPressMediaInventoryItem | WordPressPluginInventoryItem | WordPressThemeInventoryItem>;
}
export interface WordPressInventoryResponse { success: true; inventory: WordPressInventory }


export type WordPressControlledActionType = "create_post_draft";
export type WordPressControlledActionStatus =
  | "proposed"
  | "approved"
  | "executing"
  | "succeeded"
  | "failed"
  | "expired"
  | "cancelled";

export interface WordPressControlledAction {
  id: string;
  user_id: string;
  connection_id: string;
  site_id: string;
  site_url: string;
  action_type: WordPressControlledActionType;
  status: WordPressControlledActionStatus;
  payload_digest: string;
  actor_source: "user" | "approved_ai";
  created_at: string;
  expires_at: string;
  approved_at: string | null;
  executing_at: string | null;
  execution_consumed_at: string | null;
  completed_at: string | null;
  result_post_id: number | null;
  failure_code: string | null;
}

export interface WordPressCreatePostDraftPayload {
  title: string;
  content: string;
}

export interface WordPressControlledActionDetail extends WordPressControlledAction {
  payload: WordPressCreatePostDraftPayload;
}

export interface WordPressControlledActionListResponse {
  success: true;
  actions: WordPressControlledAction[];
}

export interface WordPressControlledActionDetailResponse {
  success: true;
  action: WordPressControlledActionDetail;
}

export interface WordPressControlledActionResponse {
  success: true;
  action: WordPressControlledAction;
  changed?: boolean;
}
