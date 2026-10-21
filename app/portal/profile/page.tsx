import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  // Fetch profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  // Fetch KYC status
  const { data: kyc } = await supabase
    .from("kyc_applications")
    .select("status")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  // Fetch affiliate code
  const { data: affiliateCode } = await supabase
    .from("affiliate_codes")
    .select("code")
    .eq("user_id", user.id)
    .single();

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold text-white mb-8">Profile</h1>

      <div className="space-y-6">
        {/* Contact Information */}
        <div className="glass rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Contact Information</h2>
          <div className="space-y-3">
            <div>
              <label className="text-sm text-slate-400">Phone Number</label>
              <p className="text-white font-mono">{profile?.phone_number || "—"}</p>
            </div>
            <div>
              <label className="text-sm text-slate-400">Full Name</label>
              <p className="text-white">{profile?.full_name || "Not set"}</p>
            </div>
            <div>
              <label className="text-sm text-slate-400">City</label>
              <p className="text-white">{profile?.city || "Not set"}</p>
            </div>
          </div>
        </div>

        {/* KYC Status */}
        <div className="glass rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-4">KYC Status</h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm">Verification Status</p>
              <p className="text-lg font-semibold text-white mt-1">
                {kyc?.status ? kyc.status.charAt(0).toUpperCase() + kyc.status.slice(1) : "Pending"}
              </p>
            </div>
            <a
              href="/portal/kyc"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors"
            >
              Update KYC
            </a>
          </div>
        </div>

        {/* Referral Code */}
        <div className="glass rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Referral Code</h2>
          {affiliateCode?.code ? (
            <div>
              <p className="text-slate-400 text-sm mb-2">Your referral code:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-slate-900 border border-slate-600 px-3 py-2 rounded text-white font-mono">
                  {affiliateCode.code}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(affiliateCode.code);
                  }}
                  className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded font-medium transition-colors"
                >
                  Copy
                </button>
              </div>
              <p className="text-slate-400 text-sm mt-3">
                Share this code to earn 15% commission on referred members' platform fees.
              </p>
            </div>
          ) : (
            <p className="text-slate-400">No referral code generated yet.</p>
          )}
        </div>

        {/* Account Info */}
        <div className="glass rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Account</h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">Member Since</span>
              <span className="text-white">
                {profile?.joined_at ? new Date(profile.joined_at).toLocaleDateString() : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">User ID</span>
              <span className="text-white font-mono text-xs">{user.id}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
