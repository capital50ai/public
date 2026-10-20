import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 10;
const RATE_LIMIT = 5;
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes

function generateOtp(): string {
  return Math.random().toString().slice(2, 2 + OTP_LENGTH).padStart(OTP_LENGTH, "0");
}

function maskPhone(phone: string): string {
  if (phone.length < 4) return phone;
  return "***" + phone.slice(-4);
}

export async function POST(request: NextRequest) {
  try {
    const { phoneNumber } = await request.json();

    if (!phoneNumber) {
      return NextResponse.json({ error: "Phone number required" }, { status: 400 });
    }

    // Normalize phone number to 10 digits
    const normalized = phoneNumber.replace(/\D/g, "").slice(-10);
    if (normalized.length !== 10) {
      return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
    }

    const supabase = await createClient();
    const ipAddress = request.headers.get("x-forwarded-for") || "0.0.0.0";

    // Check rate limit
    const fiveMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const { data: recentRequests, count } = await supabase
      .from("otp_sessions")
      .select("*", { count: "exact" })
      .eq("ip_address", ipAddress)
      .gte("created_at", fiveMinutesAgo.toISOString())
      .eq("verified", false);

    if ((count || 0) >= RATE_LIMIT) {
      return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
    }

    // Generate OTP
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Store OTP
    const { error: insertError } = await supabase.from("otp_sessions").insert({
      phone_number: normalized,
      otp_code: otp,
      ip_address: ipAddress,
      expires_at: expiresAt.toISOString(),
      verified: false,
      attempts: 0,
    });

    if (insertError) {
      console.error("Failed to store OTP:", insertError);
      return NextResponse.json({ error: "Failed to generate OTP" }, { status: 500 });
    }

    // TODO: Send OTP via Twilio SMS
    // For now, log it to console (development only)
    console.log(`📱 OTP for ${normalized}: ${otp}`);

    return NextResponse.json({
      success: true,
      maskedPhone: maskPhone(normalized),
      message: "OTP sent to your phone",
    });
  } catch (error) {
    console.error("OTP request error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
