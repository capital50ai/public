import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { phoneNumber, code } = await request.json();

    if (!phoneNumber || !code) {
      return NextResponse.json({ error: "Phone and code required" }, { status: 400 });
    }

    const normalized = phoneNumber.replace(/\D/g, "").slice(-10);
    const supabase = await createClient();

    // Find OTP session
    const { data: otpSession, error: otpError } = await supabase
      .from("otp_sessions")
      .select("*")
      .eq("phone_number", normalized)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (otpError || !otpSession) {
      return NextResponse.json({ error: "OTP not found or expired" }, { status: 400 });
    }

    // Check expiry
    if (new Date(otpSession.expires_at) < new Date()) {
      return NextResponse.json({ error: "OTP has expired" }, { status: 400 });
    }

    // Check attempts
    if ((otpSession.attempts || 0) >= 5) {
      return NextResponse.json({ error: "Too many failed attempts. Request a new OTP." }, { status: 429 });
    }

    // Verify code
    if (otpSession.otp_code !== code) {
      await supabase
        .from("otp_sessions")
        .update({ attempts: (otpSession.attempts || 0) + 1 })
        .eq("id", otpSession.id);

      return NextResponse.json({ error: "Invalid OTP code" }, { status: 400 });
    }

    // Mark as verified
    await supabase
      .from("otp_sessions")
      .update({ verified: true })
      .eq("id", otpSession.id);

    // Check if user exists, create if not
    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("phone_number", normalized)
      .single();

    let userId: string;
    if (existingProfile) {
      userId = existingProfile.id;
    } else {
      // Create new profile
      const { data: newProfile, error: createError } = await supabase
        .from("profiles")
        .insert({
          phone_number: normalized,
          kyc_status: "pending",
        })
        .select("id")
        .single();

      if (createError || !newProfile) {
        console.error("Failed to create profile:", createError);
        return NextResponse.json({ error: "Failed to create account" }, { status: 500 });
      }

      userId = newProfile.id;

      // Generate affiliate code
      const affiliateCode = `REF${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      await supabase.from("affiliate_codes").insert({
        user_id: userId,
        code: affiliateCode,
      });
    }

    // Create auth session (mock - in production use Supabase Auth)
    // For now, return tokens that can be stored in localStorage
    const accessToken = `token_${userId}_${Date.now()}`;
    const refreshToken = `refresh_${userId}_${Date.now()}`;

    // Log login event to audit
    await supabase.from("audit_log").insert({
      table_name: "profiles",
      record_id: userId,
      action: "LOGIN",
      actor_id: userId,
      reason: "Phone OTP verification",
    });

    return NextResponse.json({
      success: true,
      access_token: accessToken,
      refresh_token: refreshToken,
      user_id: userId,
      message: "Login successful",
    });
  } catch (error) {
    console.error("OTP verification error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
