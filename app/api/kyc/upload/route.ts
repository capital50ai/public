import sharp from "sharp";
import { createHash, randomUUID } from "node:crypto";
import { isLive } from "@/lib/backend";
import { fail } from "@/lib/request";
import { withinLimit } from "@/lib/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { DOC_KINDS, sniffType } from "@/lib/kyc";
import { latestApplication } from "@/lib/kyc-server";

const MAX = 5 * 1024 * 1024;

// One KYC document: multipart form with `kind` (kFront | kBack | selfie) and `file`.
export async function POST(req: Request) {
  if (!isLive()) return Response.json({ preview: true });
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return fail("Please log in again.", 401);
  if (Number(req.headers.get("content-length") || 0) > MAX + 64 * 1024) return fail("File is over 5 MB.", 413);
  if (!(await withinLimit(`kyc-upload:${user.id}`, 30, 3600))) return fail("Too many uploads. Try again in an hour.", 429);

  const form = await req.formData().catch(() => null);
  const kind = DOC_KINDS[String(form?.get("kind")) as keyof typeof DOC_KINDS];
  const file = form?.get("file");
  if (!kind || !(file instanceof File)) return fail("Choose a file to upload.");
  if (file.size > MAX) return fail("File is over 5 MB.", 413);

  const app = await latestApplication(user.id);
  if (!app || app.status !== "draft") return fail("Complete your personal details first.", 409);

  let buf: Buffer = Buffer.from(await file.arrayBuffer());
  let mime = sniffType(buf);
  if (!mime || (kind === "selfie" && mime === "application/pdf")) return fail(kind === "selfie" ? "Use a JPG or PNG photo." : "Use JPG, PNG or PDF.");

  // Re-encode photos: applies the camera rotation and drops hidden metadata such as GPS location.
  if (mime !== "application/pdf") {
    try {
      const img = sharp(buf, { limitInputPixels: 50_000_000 }).rotate();
      buf = mime === "image/png" ? await img.png().toBuffer() : await img.jpeg({ quality: 90 }).toBuffer();
    } catch {
      return fail("We couldn't read that image. Try another photo.");
    }
    mime = sniffType(buf) ?? mime;
  }

  const ext = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg";
  const path = `${user.id}/${app.id}/${kind}-${randomUUID()}.${ext}`;
  const admin = createAdminClient();
  const { error: upErr } = await admin.storage.from("kyc").upload(path, buf, { contentType: mime, upsert: false });
  if (upErr) {
    console.error("kyc upload failed", upErr.message);
    return fail("Upload failed. Please try again.", 500);
  }
  const { error } = await admin.from("kyc_documents").insert({
    application_id: app.id, user_id: user.id, kind, storage_path: path, mime, size_bytes: buf.length,
    sha256: createHash("sha256").update(buf).digest("hex"),
  });
  if (error) {
    await admin.storage.from("kyc").remove([path]);
    return fail("Upload failed. Please try again.", 500);
  }
  return Response.json({ ok: true });
}
