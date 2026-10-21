import "server-only";
import { unstable_cache } from "next/cache";
import { isLive } from "@/lib/backend";
import { createPublicClient } from "@/lib/supabase/admin";
import bundled from "@/data/records.json";

// Shape the front-end expects as `REAL`.
export type Real = {
  records: Record<string, { ym: string; r: number }[]>;
  mtd: ({ ym: string } & Record<string, number | string>) | null;
};

// Key order the pages were built with.
const ORDER = ["gold", "crypto", "ecom", "sat", "prompt", "kitchen"];

type Row = { ym: string; return_pct: number | string; status: "mtd" | "published"; strategies: { slug: string } };

async function loadFromDb(): Promise<Real> {
  const { data, error } = await createPublicClient()
    .from("strategy_returns")
    .select("ym, return_pct, status, strategies!inner(slug, active)")
    .in("status", ["published", "mtd"])
    .eq("strategies.active", true)
    .order("ym", { ascending: true })
    .returns<Row[]>();
  if (error) throw new Error(`strategy_returns: ${error.message}`);
  if (!data?.length) throw new Error("strategy_returns is empty");

  const records: Real["records"] = {};
  const mtdRows: Row[] = [];
  for (const row of data) {
    if (row.status === "mtd") {
      mtdRows.push(row);
      continue;
    }
    const slug = row.strategies.slug;
    (records[slug] ??= []).push({ ym: row.ym.slice(0, 7), r: Number(row.return_pct) });
  }

  const slugs = [...ORDER.filter((s) => records[s]), ...Object.keys(records).filter((s) => !ORDER.includes(s))];
  const ordered = Object.fromEntries(slugs.map((s) => [s, records[s]]));

  let mtd: Real["mtd"] = null;
  const latest = mtdRows.reduce((m, r) => (r.ym > m ? r.ym : m), "");
  if (latest) {
    mtd = { ym: latest.slice(0, 7) };
    for (const r of mtdRows) if (r.ym === latest) mtd[r.strategies.slug] = Number(r.return_pct);
  }
  return { records: ordered, mtd };
}

const cachedFromDb = unstable_cache(loadFromDb, ["strategy-returns"], { revalidate: 300, tags: ["returns"] });

// Returns always come from strategy_returns once the backend is live. The bundled copy is the
// same published record the database was seeded from, used only before go-live or if the
// database can't be reached (logged, never silent).
export async function getReal(): Promise<Real> {
  if (!isLive()) return bundled as Real;
  try {
    return await cachedFromDb();
  } catch (e) {
    console.error("returns: falling back to bundled records", e);
    return bundled as Real;
  }
}
