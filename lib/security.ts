import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Returns false when the key has used up its allowance for the window.
export async function withinLimit(key: string, max: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("consume_rate_limit", {
    p_key: key,
    p_max: max,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    // Fail closed: if the limiter can't be reached, don't let auth attempts through unchecked.
    console.error("rate limit check failed", error.message);
    return false;
  }
  return data === true;
}

export async function audit(entry: {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  after?: Record<string, unknown>;
  ip?: string;
}) {
  const { error } = await createAdminClient().from("audit_log").insert({
    actor_id: entry.actorId ?? null,
    actor_role: "investor",
    action: entry.action,
    entity: entry.entity,
    entity_id: entry.entityId ?? null,
    after: entry.after ?? null,
    ip: entry.ip && entry.ip !== "0.0.0.0" ? entry.ip : null,
  });
  if (error) console.error("audit insert failed", entry.action, error.message);
}
