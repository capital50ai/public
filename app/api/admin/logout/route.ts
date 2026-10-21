import { createClient } from "@/lib/supabase/server";

async function logout(req: Request) {
  await (await createClient()).auth.signOut();
  return Response.redirect(new URL("/admin/login", req.url), 303);
}
export const GET = logout;
export const POST = logout;
