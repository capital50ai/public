import "server-only";
import { notFound } from "next/navigation";
import { requireStaffApi, requireStaffPage, sameOrigin, type Staff } from "@/lib/staff";

export const rs = (n: number | string | null | undefined) =>
  "Rs " + Number(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
export const when = (t: string | null | undefined) =>
  t ? new Date(t).toLocaleString("en-GB", { timeZone: "Asia/Karachi", dateStyle: "medium", timeStyle: "short" }) : "—";
export const localPhone = (p: string | null | undefined) => (p ? `0${p.slice(3)}` : "—");
export const monthLabel = (ym: string) =>
  new Date(`${ym.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

// A staff page that only some roles may open (others get a 404, not a hint that it exists).
export async function requireRolePage(roles: Staff["role"][]): Promise<Staff> {
  const staff = await requireStaffPage();
  if (!roles.includes(staff.role)) notFound();
  return staff;
}

// Runs a staff form post: same-origin and role checked, then redirects back to `back` with either
// ?done=<message> or ?error=<message>. Database functions raise messages written for staff.
export async function staffAction(
  req: Request,
  roles: Staff["role"][],
  back: string,
  run: (staff: Staff, form: FormData) => Promise<string>,
): Promise<Response> {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const staff = await requireStaffApi(roles);
  if (!staff) return new Response("Forbidden", { status: 403 });
  let q: string;
  try {
    q = `done=${encodeURIComponent(await run(staff, await req.formData()))}`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("staff action failed", back, msg);
    q = `error=${encodeURIComponent(msg.slice(0, 300))}`;
  }
  const url = new URL(back, req.url);
  url.search = (url.search ? url.search.slice(1) + "&" : "") + q;
  return Response.redirect(url, 303);
}

// Supabase rpc that throws on error, so staffAction can show the message.
export function must<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

export const text = (form: FormData, key: string, max = 300) => String(form.get(key) ?? "").trim().slice(0, max);
