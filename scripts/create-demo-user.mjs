// Creates (or resets) the demo investor account in Supabase.
// Usage: node --env-file=.env.local scripts/create-demo-user.mjs
import { createClient } from "@supabase/supabase-js";

const PHONE = "+923001234567";
const PASSWORD = process.env.DEMO_PASSWORD || "Demo#2026";
const META = { full_name: "Demo Investor", email: "demo@capital50.ai", risk_ack_at: new Date().toISOString() };

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: profile } = await admin.from("profiles").select("user_id").eq("phone", PHONE).maybeSingle();
if (profile) {
  const { error } = await admin.auth.admin.updateUserById(profile.user_id, { password: PASSWORD, phone_confirm: true });
  if (error) throw error;
  console.log("Demo user existed; password reset.");
} else {
  const { error } = await admin.auth.admin.createUser({ phone: PHONE, password: PASSWORD, phone_confirm: true, user_metadata: META });
  if (error) throw error;
  console.log("Demo user created.");
}
console.log(`Log in with mobile ${PHONE.slice(3, 6)} ${PHONE.slice(6)} and password ${PASSWORD}`);
