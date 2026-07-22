import * as oidc from "openid-client";
import { type Request, type Response, type NextFunction } from "express";
import type { AuthUser } from "@workspace/api-zod";
import {
  clearSession,
  getOidcConfig,
  getSessionId,
  getSession,
  updateSession,
  type SessionData,
} from "../lib/auth";
import { eq } from "drizzle-orm";
import { db, apiTokensTable, usersTable } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  evaluateShortcutAuth, hashTokenSecret, isShortcutRouteAllowed, isShortcutToken,
} from "../lib/shortcut-token";

declare global {
  namespace Express {
    interface User extends AuthUser {}

    interface Request {
      isAuthenticated(): this is AuthedRequest;
      user?: User | undefined;
      gameUserId?: number | undefined;
    }

    export interface AuthedRequest extends Request {
      user: User;
      gameUserId: number;
    }
  }
}

async function refreshIfExpired(
  sid: string,
  session: SessionData,
): Promise<SessionData | null> {
  const now = Math.floor(Date.now() / 1000);
  if (!session.expires_at || now <= session.expires_at) return session;

  if (!session.refresh_token) return null;

  try {
    const config = await getOidcConfig();
    const tokens = await oidc.refreshTokenGrant(
      config,
      session.refresh_token,
    );
    session.access_token = tokens.access_token;
    session.refresh_token = tokens.refresh_token ?? session.refresh_token;
    session.expires_at = tokens.expiresIn()
      ? now + tokens.expiresIn()!
      : session.expires_at;
    await updateSession(sid, session);
    return session;
  } catch {
    return null;
  }
}

async function applyShortcutTokenAuth(req: Request, bearer: string): Promise<void> {
  // Default-deny: off-whitelist requests never even touch the database.
  if (!isShortcutRouteAllowed(req.method, req.path)) return;

  const [row] = await db.select().from(apiTokensTable)
    .where(eq(apiTokensTable.tokenHash, hashTokenSecret(bearer)));
  const decision = evaluateShortcutAuth({
    bearer, method: req.method, path: req.path, tokenRow: row,
  });
  if (decision.kind !== "allow" || !row) return;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, row.userId));
  if (!user) return;

  // Same contract the session path produces; handlers only ever read gameUserId.
  req.user = {
    id: user.externalId ?? String(user.id),
    email: null,
    firstName: user.displayName ?? user.username,
    lastName: null,
    profileImageUrl: null,
  };
  req.gameUserId = user.id;

  if (decision.refreshLastUsed) {
    // Fire-and-forget: an hourly freshness marker isn't worth request latency.
    void (async () => {
      await db.update(apiTokensTable)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiTokensTable.id, row.id));
    })().catch((err) => logger.warn({ err }, "api token last_used update failed"));
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  req.isAuthenticated = function (this: Request) {
    return this.user != null && this.gameUserId != null;
  } as Request["isAuthenticated"];

  const authHeader = req.headers["authorization"];
  const isBearerAuth = typeof authHeader === "string" && authHeader.startsWith("Bearer ");

  // Pocket Gate (spec D4): an fqs_ bearer is a shortcut token, never a session
  // id. Handle it entirely here — valid tokens authenticate the three
  // whitelisted routes; everything else falls through unauthenticated and the
  // route's own isAuthenticated() check returns the usual 401.
  const bearer = isBearerAuth ? authHeader.slice(7).trimStart() : undefined;
  if (bearer !== undefined && isShortcutToken(bearer)) {
    await applyShortcutTokenAuth(req, bearer);
    next();
    return;
  }

  const sid = getSessionId(req);
  if (!sid) {
    next();
    return;
  }

  if (!isBearerAuth) {
    const reqOrigin = req.headers["origin"];
    if (reqOrigin) {
      const proto = req.headers["x-forwarded-proto"] ?? "https";
      const host = req.headers["x-forwarded-host"] ?? req.headers["host"] ?? "";
      const expectedOrigin = `${proto}://${host}`;
      if (reqOrigin !== expectedOrigin) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    }
  }

  const session = await getSession(sid);
  if (!session?.user?.id || !session.gameUserId) {
    await clearSession(res, sid);
    next();
    return;
  }

  const refreshed = await refreshIfExpired(sid, session);
  if (!refreshed) {
    await clearSession(res, sid);
    next();
    return;
  }

  req.user = refreshed.user;
  req.gameUserId = refreshed.gameUserId;
  next();
}
