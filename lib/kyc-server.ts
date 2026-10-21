import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export type KycApp = {
  id: string;
  status: "draft" | "review" | "verified" | "rejected";
  personal: Record<string, string>;
  financial: Record<string, unknown>;
  rejection_reason: string | null;
  submitted_at: string | null;
};

// Shape the dashboard keeps as ST.kyc.
export type KycState = {
  status: "none" | KycApp["status"];
  step: number;
  data: Record<string, unknown>;
  files: Record<string, string>;
  reason?: string;
  submitted?: number;
};

const FILE_KEY = { cnic_front: "kFront", cnic_back: "kBack", selfie: "selfie" } as const;

export const cnicHash = (cnic: string) => createHash("sha256").update(cnic.replace(/\D/g, "")).digest("hex");

export async function latestApplication(userId: string): Promise<KycApp | null> {
  const { data, error } = await createAdminClient()
    .from("kyc_applications")
    .select("id, status, personal, financial, rejection_reason, submitted_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`kyc_applications: ${error.message}`);
  return data as KycApp | null;
}

export async function documentKinds(applicationId: string): Promise<Set<string>> {
  const { data, error } = await createAdminClient().from("kyc_documents").select("kind").eq("application_id", applicationId);
  if (error) throw new Error(`kyc_documents: ${error.message}`);
  return new Set(data.map((d) => d.kind as string));
}

export async function kycState(userId: string): Promise<KycState> {
  const app = await latestApplication(userId);
  if (!app) return { status: "none", step: 0, data: {}, files: {} };
  const data = { ...app.personal, ...app.financial };
  if (app.status === "rejected")
    return { status: "rejected", step: 0, data, files: {}, reason: app.rejection_reason ?? "" };

  const kinds = await documentKinds(app.id);
  const files: Record<string, string> = {};
  for (const k of kinds) files[FILE_KEY[k as keyof typeof FILE_KEY]] = "uploaded";
  const submitted = app.submitted_at ? Date.parse(app.submitted_at) : undefined;
  if (app.status !== "draft") return { status: app.status, step: 4, data, files, submitted };

  const step = !app.personal.fullName ? 0 : !app.financial.occ ? 1
    : !(kinds.has("cnic_front") && kinds.has("cnic_back")) ? 2 : !kinds.has("selfie") ? 3 : 4;
  return { status: "draft", step, data, files };
}
