import { prisma } from "@calcom/prisma";

/**
 * Serve an uploaded room photo.
 *
 * Public: these appear on the room listing, which exhibitors browse. The key is
 * a fresh UUID on every upload, so the response is immutable and can be cached
 * hard — replacing a photo changes the URL rather than the bytes behind it.
 *
 * Content-Type is the one validated at upload, never anything derived from the
 * request, and nosniff stops a browser second-guessing it.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string }> }
): Promise<Response> {
  const { key } = await params;

  const image = await prisma.ne26RoomImage.findUnique({
    where: { key },
    select: { data: true, mimeType: true },
  });
  if (!image) return new Response("Not found", { status: 404 });

  const bytes = Buffer.from(image.data, "base64");
  return new Response(bytes, {
    headers: {
      "Content-Type": image.mimeType,
      "Content-Length": String(bytes.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      // These are photographs, not documents — never let one be rendered as a
      // page in its own right if the type check is ever bypassed.
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
