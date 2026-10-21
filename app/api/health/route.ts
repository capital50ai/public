export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ status: 'ok', time: new Date().toISOString() });
}
