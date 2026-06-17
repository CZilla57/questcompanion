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
