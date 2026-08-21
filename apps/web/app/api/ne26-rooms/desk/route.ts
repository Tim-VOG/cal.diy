import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getNe26RoomSettingsRepository } from "@calcom/features/ne26-rooms/di/Ne26RoomSettingsRepository.container";
import { getNe26StaffRepository } from "@calcom/features/ne26-rooms/di/Ne26StaffRepository.container";
import {
  DESK_COOKIE,
  deskSessionFromCookieHeader,
  encodeDeskSession,
  isValidPin,
  nextLockState,
  pinLockRemainingMs,
  verifyPin,
} from "@calcom/features/ne26-rooms/lib/deskSession";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { cookies, headers } from "next/headers";

const COOKIE_BASE = "Path=/; HttpOnly; SameSite=Lax";

function secureFlag(): string {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}

/**
 * Enter or leave desk mode.
 *
 * Entering narrows an admin session to the welcome desk; leaving requires the
 * PIN. Both directions are decided here, on the server, because the cookie is a
 * restriction rather than a preference — a client that could set or clear it
 * freely would make the whole thing decorative.
 */
export async function POST(req: Request): Promise<Response> {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) return Response.json({ error: "Not signed in" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { action?: string; hostessName?: string; pin?: string };
  const settings = getNe26RoomSettingsRepository();
  const staff = getNe26StaffRepository();
  const cookieHeader = (await headers()).get("cookie");
  const current = deskSessionFromCookieHeader(cookieHeader);

  if (body.action === "enter") {
    // Only an administrator can put a tablet into desk mode — and only from an
    // unrestricted session, so desk mode cannot be re-entered under a new name
    // to launder who did what.
    if (session.user.role !== "ADMIN" || current) {
      return Response.json({ error: "Admins only." }, { status: 403 });
    }
    const hostessName = (body.hostessName ?? "").trim().slice(0, 80);
    if (!hostessName) {
      return Response.json({ error: "Enter the name of whoever is on the desk." }, { status: 400 });
    }
    const pin = await settings.getDeskPinState();
    if (!pin.hash) {
      return Response.json(
        { error: "Set a desk PIN in Admin → Settings first, or there would be no way out of desk mode." },
        { status: 400 }
      );
    }

    await staff.recordAction({
      actorUserId: session.user.id,
      actorEmail: session.user.email ?? "",
      actorRole: "ADMIN",
      action: "desk.enter",
      detail: `Desk mode started — ${hostessName} on duty`,
    });

    const value = encodeDeskSession({ hostessName, startedAt: Math.floor(Date.now() / 1000) });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": `${DESK_COOKIE}=${encodeURIComponent(value)}; ${COOKIE_BASE}${secureFlag()}; Max-Age=${16 * 60 * 60}`,
      },
    });
  }

  if (body.action === "exit") {
    if (!current) return Response.json({ ok: true }, { status: 200 });

    const state = await settings.getDeskPinState();
    const remaining = pinLockRemainingMs({
      failedAttempts: state.failedAttempts,
      lockedUntil: state.lockedUntil,
    });
    if (remaining > 0) {
      return Response.json(
        { error: `Too many wrong PINs. Try again in ${Math.ceil(remaining / 60000)} minutes.` },
        { status: 429 }
      );
    }

    const pin = body.pin ?? "";
    if (!isValidPin(pin) || !verifyPin(pin, state.hash)) {
      const next = nextLockState({
        failedAttempts: state.failedAttempts,
        lockedUntil: state.lockedUntil,
      });
      await settings.setDeskPinLockState(next.failedAttempts, next.lockedUntil);
      await staff.recordAction({
        actorUserId: session.user.id,
        actorEmail: current.hostessName,
        actorRole: "HOSTESS",
        action: "desk.exit.failed",
        detail: "Wrong PIN entered to leave desk mode",
      });
      return Response.json({ error: "Wrong PIN." }, { status: 403 });
    }

    await settings.setDeskPinLockState(0, null);
    await staff.recordAction({
      actorUserId: session.user.id,
      actorEmail: session.user.email ?? "",
      actorRole: "ADMIN",
      action: "desk.exit",
      detail: `Desk mode ended — ${current.hostessName} was on duty`,
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": `${DESK_COOKIE}=; ${COOKIE_BASE}${secureFlag()}; Max-Age=0`,
      },
    });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
