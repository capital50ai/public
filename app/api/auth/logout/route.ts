import { isLive } from "@/lib/backend";
import { createClient } from "@/lib/supabase/server";

async function logout(req: Request) {
  if (isLive()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  return Response.redirect(new URL("/auth.html", req.url), 303);
}

export const GET = logout;
export const POST = logout;
