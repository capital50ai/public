import { getReal } from "@/lib/returns";

export const dynamic = "force-dynamic";

// Public: published monthly returns per strategy, plus month-to-date figures.
export async function GET() {
  return Response.json(await getReal(), {
    headers: { "cache-control": "public, max-age=0, s-maxage=300, stale-while-revalidate=86400" },
  });
}
