import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // Fetch trader profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) {
    redirect("/auth/login");
  }

  const menuItems = [
    { href: "/portal/profile", label: "Profile" },
    { href: "/portal/holdings", label: "Holdings" },
    { href: "/portal/ledger", label: "Ledger" },
    { href: "/portal/affiliates", label: "Affiliates" },
    { href: "/portal/withdrawals", label: "Withdrawals" },
    { href: "/portal/kyc", label: "KYC" },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex">
      {/* Sidebar */}
      <div className="w-64 border-r border-slate-800 p-6 flex flex-col">
        <h1 className="text-2xl font-bold text-white mb-8">Capital 50</h1>
        <nav className="flex-1 space-y-2">
          {menuItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block px-4 py-2 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <button
          onClick={() => {
            localStorage.removeItem("auth_token");
            localStorage.removeItem("refresh_token");
            localStorage.removeItem("user_id");
            window.location.href = "/auth/login";
          }}
          className="w-full px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg transition"
        >
          Logout
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1">
        {/* Header */}
        <div className="border-b border-slate-800 px-8 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-white">Trader Portal</h1>
          <div className="text-right">
            <p className="text-slate-400 text-sm">Welcome</p>
            <p className="text-white font-mono">{profile.phone_number}</p>
          </div>
        </div>

        {/* Page Content */}
        <div className="p-8">{children}</div>
      </div>
    </div>
  );
}
