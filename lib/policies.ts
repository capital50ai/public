import "server-only";
import { unstable_cache } from "next/cache";
import { isLive } from "@/lib/backend";
import { createAdminClient } from "@/lib/supabase/admin";

export type Policy = { text: string; published: boolean; at: string };
export const POLICY_IDS = [
  ["company", "Company identity"], ["contact", "Contact & support"], ["how", "How the platform works"],
  ["strategies", "How each strategy operates"], ["fees", "Fees & charges"], ["deposits", "Deposits, withdrawals & timing"],
  ["custody", "Custody of your funds"], ["risks", "Risks"], ["eligibility", "Eligibility & locations"],
  ["terms", "Terms & conditions"], ["privacy", "Privacy & your data"], ["complaints", "Complaints & disputes"],
] as const;

export async function allPolicies(): Promise<Record<string, Policy>> {
  const { data, error } = await createAdminClient().from("app_settings").select("value").eq("key", "policies").maybeSingle();
  if (error) throw new Error(`policies: ${error.message}`);
  return (data?.value ?? {}) as Record<string, Policy>;
}

// Only what the owner published, for the public site. Cached; publishing refreshes it.
const cached = unstable_cache(async () => {
  const all = await allPolicies();
  return Object.fromEntries(Object.entries(all).filter(([, p]) => p.published).map(([id, p]) => [id, { text: p.text, at: p.at }]));
}, ["policies"], { revalidate: 300, tags: ["policies"] });

export async function publishedPolicies(): Promise<Record<string, { text: string; at: string }>> {
  if (!isLive()) return {};
  try {
    return await cached();
  } catch (e) {
    console.error("published policies unavailable", (e as Error).message);
    return {};
  }
}
