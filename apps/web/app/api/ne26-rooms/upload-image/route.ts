import { randomUUID } from "node:crypto";
import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { checkRoomImage, roomImageUrl } from "@calcom/features/ne26-rooms/lib/roomImage";
import { prisma } from "@calcom/prisma";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { cookies, headers } from "next/headers";

/**
 * Receive a room photo from the admin and return the URL to store on the room.
 *
 * Admin-only, and the bytes are checked against their declared type rather than
 * trusted: an upload endpoint that believes the browser is how a "photo" becomes
 * an HTML or SVG file served from our own origin.
 */
export async function POST(req: Request): Promise<Response> {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (session.user.role !== "ADMIN") return Response.json({ error: "Admins only" }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No file was uploaded." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkRoomImage(file.type, bytes);
  if (!check.ok) return Response.json({ error: check.message }, { status: 400 });

  // A fresh key per upload, so replacing a photo can never serve the old one
  // from a cache — the URL itself changes.
  const key = `${randomUUID()}.${check.ext}`;
  await prisma.ne26RoomImage.create({
    data: {
      key,
      data: Buffer.from(bytes).toString("base64"),
      mimeType: check.mimeType,
      bytes: bytes.length,
      uploadedByEmail: session.user.email ?? null,
    },
  });

  return Response.json({ url: roomImageUrl(key) }, { status: 201 });
}
