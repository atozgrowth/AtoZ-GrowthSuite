import { createHash, randomBytes } from "node:crypto";
import type {
  InspectionConnection,
  InspectionGrantRepository,
  ReadGrantAuthorization,
  ReadGrantScope,
} from "./site-inspection.js";
export interface RpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
const digest = (value: string) =>
  "\\x" + createHash("sha256").update(value).digest("hex");
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
export class DurableOperationGrantStore implements InspectionGrantRepository {
  constructor(
    private readonly client: RpcClient,
    private readonly now: () => number = Date.now,
  ) {}
  async issue(
    connection: InspectionConnection,
    authorization: ReadGrantAuthorization = { scope: "inspection" },
  ) {
    return this.issueOperation(connection, {
      scope: authorization.scope,
      page: authorization.page,
      perPage: authorization.perPage,
    });
  }
  async issueOperation(
    c: InspectionConnection,
    a: {
      scope: string;
      page?: number;
      perPage?: number;
      postId?: number;
      actionId?: string;
      payloadDigest?: string;
    },
  ) {
    const grant = randomBytes(32).toString("base64url");
    const { data, error } = await this.client.rpc(
      "wp_manager_issue_operation_grant",
      {
        p_user_id: c.user_id,
        p_connection_id: c.id,
        p_scope: a.scope,
        p_digest: digest(grant),
        p_expires_at: new Date(this.now() + 30000).toISOString(),
        p_page: a.page ?? null,
        p_per_page: a.perPage ?? null,
        p_post_id: a.postId ?? null,
        p_action_id: a.actionId ?? null,
        p_payload_digest: a.payloadDigest ? "\\x" + a.payloadDigest : null,
      },
    );
    if (error || data !== true) throw Error("Grant issuance unavailable");
    return grant;
  }
  async consume(i: {
    grant: string;
    siteId: string;
    siteUrl: string;
    scope?: ReadGrantScope;
    page?: number;
    perPage?: number;
  }) {
    return this.consumeOperation({ ...i, scope: i.scope ?? "inspection" });
  }
  async consumeOperation(i: {
    grant: string;
    siteId: string;
    siteUrl: string;
    scope: string;
    page?: number;
    perPage?: number;
    postId?: number;
    actionId?: string;
    payloadDigest?: string;
    actionType?: string;
  }) {
    if (!tokenPattern.test(i.grant)) return false;
    try {
      const { data, error } = await this.client.rpc(
        "wp_manager_consume_operation_grant",
        {
          p_digest: digest(i.grant),
          p_site_id: i.siteId,
          p_site_url: i.siteUrl,
          p_scope: i.scope,
          p_page: i.page ?? null,
          p_per_page: i.perPage ?? null,
          p_post_id: i.postId ?? null,
          p_action_id: i.actionId ?? null,
          p_payload_digest: i.payloadDigest ? "\\x" + i.payloadDigest : null,
          p_action_type: i.actionType ?? null,
        },
      );
      return !error && data === true;
    } catch {
      return false;
    }
  }
  async revoke(grant: string) {
    if (!tokenPattern.test(grant)) return;
    const { error } = await this.client.rpc(
      "wp_manager_revoke_operation_grant",
      { p_digest: digest(grant) },
    );
    if (error) throw Error("Grant revocation unavailable");
  }
}
