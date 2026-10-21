"use client";

export const dynamic = 'force-static';

import { useOtp } from "@/lib/auth/use-otp";
import { useRouter } from "next/navigation";
import { FormEvent } from "react";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const otp = useOtp();

  const handlePhoneSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await otp.requestOtp();
  };

  const handleCodeSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await otp.verifyOtp();
      router.push("/portal/profile");
    } catch {
      // Error is already set in the hook
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">Capital 50</h1>
          <p className="text-slate-400">AI-Powered Investment Platform</p>
        </div>

        {/* Card */}
        <div className="glass rounded-2xl p-8 shadow-2xl">
          {otp.step === "phone" ? (
            <form onSubmit={handlePhoneSubmit} className="space-y-6">
              <h2 className="text-2xl font-bold text-white">Welcome Back</h2>

              {otp.error && (
                <div className="bg-red-900/30 border border-red-700 text-red-200 px-4 py-3 rounded-lg text-sm">
                  {otp.error}
                </div>
              )}

              <div>
                <label className="block text-sm text-slate-300 mb-2">Phone Number</label>
                <div className="flex gap-2">
                  <select
                    defaultValue="+92"
                    className="px-3 py-3 bg-slate-800/50 border border-slate-700 rounded-lg text-white font-mono text-sm"
                  >
                    <option value="+92">+92</option>
                  </select>
                  <input
                    type="tel"
                    placeholder="3001234567"
                    maxLength={10}
                    value={otp.phoneNumber}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "");
                      otp.setPhoneNumber(val);
                    }}
                    className="flex-1 px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:bg-slate-800"
                  />
                </div>
                <p className="text-xs text-slate-400 mt-2">Enter 10-digit mobile number</p>
              </div>

              <button
                type="submit"
                disabled={otp.phoneNumber.length !== 10 || otp.loading}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white font-semibold rounded-lg transition-colors disabled:cursor-not-allowed"
              >
                {otp.loading ? "Sending..." : "Send OTP"}
              </button>

              <p className="text-center text-slate-400 text-sm">
                Don't have an account?{" "}
                <Link href="/auth/register" className="text-blue-400 hover:text-blue-300">
                  Sign Up
                </Link>
              </p>
            </form>
          ) : (
            <form onSubmit={handleCodeSubmit} className="space-y-6">
              <h2 className="text-2xl font-bold text-white">Verify Code</h2>

              {otp.error && (
                <div className="bg-red-900/30 border border-red-700 text-red-200 px-4 py-3 rounded-lg text-sm">
                  {otp.error}
                </div>
              )}

              <div className="text-center">
                <p className="text-slate-400 text-sm mb-2">Code sent to</p>
                <p className="text-white font-mono text-lg font-semibold">{otp.phoneMasked}</p>
              </div>

              <div>
                <label className="block text-sm text-slate-300 mb-2">Enter 6-digit Code</label>
                <input
                  type="text"
                  maxLength={6}
                  placeholder="000000"
                  value={otp.code}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "");
                    otp.setCode(val);
                  }}
                  className="w-full text-center text-3xl tracking-widest font-mono px-4 py-4 bg-slate-800/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <button
                type="submit"
                disabled={otp.code.length !== 6 || otp.loading}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white font-semibold rounded-lg transition-colors disabled:cursor-not-allowed"
              >
                {otp.loading ? "Verifying..." : "Verify Code"}
              </button>

              <button
                type="button"
                onClick={() => otp.reset()}
                className="w-full text-blue-400 hover:text-blue-300 font-medium text-sm"
              >
                Change Phone Number
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
