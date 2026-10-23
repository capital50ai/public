import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

// Trusted devices: a browser that passed an SMS code once. With LOGIN_NEW_DEVICE_CODE=on, logging in
// from any other browser asks for a code first. Keep it off until real SMS (Twilio) is connected.
export const DEVICE_COOKIE = "c50_dev";
export const newDeviceCodeOn = () => process.env.LOGIN_NEW_DEVICE_CODE === "on";

const hash = (id: string) => createHash("sha256").update(id).digest("hex");

export async function deviceTrusted(userId: string): Promise<boolean> {
  const id = (await cookies()).get(DEVICE_COOKIE)?.value;
  if (!id || !/^[A-Za-z0-9_-]{20,64}$/.test(id)) return false;
  const { data } = await createAdminClient().from("trusted_devices").update({ last_seen_at: new Date().toISOString() })
    .eq("user_id", userId).eq("device_hash", hash(id)).select("user_id").maybeSingle();
  return !!data;
}

// Called after an SMS code is verified on this browser.
export async function trustThisDevice(userId: string, userAgent: string | null): Promise<void> {
  const jar = await cookies();
  let id = jar.get(DEVICE_COOKIE)?.value;
  if (!id || !/^[A-Za-z0-9_-]{20,64}$/.test(id)) {
    id = randomBytes(24).toString("base64url");
    jar.set(DEVICE_COOKIE, id, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 365 * 86400 });
  }
  const label = /iPhone|iPad/.test(userAgent ?? "") ? "iPhone" : /Android/.test(userAgent ?? "") ? "Android" : "Browser";
  const { error } = await createAdminClient().from("trusted_devices")
    .upsert({ user_id: userId, device_hash: hash(id), label, last_seen_at: new Date().toISOString() });
  if (error && !/trusted_devices/.test(error.message)) console.error("trust device failed", error.message);
}
