import "server-only";

// The backend stays off (preview behaviour) until the owner has connected Supabase
// and set C50_BACKEND=live in Vercel. This keeps the shared demo link working meanwhile.
export function isLive(): boolean {
  return (
    process.env.C50_BACKEND === "live" &&
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    !!process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}
