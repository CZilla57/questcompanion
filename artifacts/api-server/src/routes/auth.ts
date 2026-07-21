import { randomUUID } from "node:crypto";
import * as oidc from "openid-client";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetCurrentAuthUserResponse,
  ExchangeMobileAuthorizationCodeBody,
  ExchangeMobileAuthorizationCodeResponse,
  LogoutMobileSessionResponse,
} from "@workspace/api-zod";
import { db, usersTable, tasksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { resolveEmailCapture } from "../lib/weekly-recap";
import { buildStarterQuestRows } from "../lib/starter-quests";
import { logger } from "../lib/logger";
import {
  clearSession,
  getOidcConfig,
  getSessionId,
  createSession,
  deleteSession,
  SESSION_COOKIE,
  SESSION_TTL,
  ISSUER_URL,
  type SessionData,
} from "../lib/auth";

const OIDC_COOKIE_TTL = 10 * 60 * 1000;

const router: IRouter = Router();

function getOrigin(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host =
    req.headers["x-forwarded-host"] || req.headers["host"] || "localhost";
  return `${proto}://${host}`;
}

function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

function setOidcCookie(res: Response, name: string, value: string) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: OIDC_COOKIE_TTL,
  });
}

function getSafeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

function generateUsername(claims: Record<string, unknown>): string {
  const first = String(claims.first_name ?? claims.given_name ?? "").trim();
  const last = String(claims.last_name ?? claims.family_name ?? "").trim();
  const base = (first + last).replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "hero";
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `${base}${suffix}`;
}

async function upsertGameUser(claims: Record<string, unknown>): Promise<{ id: number }> {
  const externalId = String(claims.sub);

  const [existing] = await db
    .select({ id: usersTable.id, email: usersTable.email, recapUnsubscribeToken: usersTable.recapUnsubscribeToken })
    .from(usersTable)
    .where(eq(usersTable.externalId, externalId));

  if (existing) {
    const capture = resolveEmailCapture(claims.email, existing, randomUUID);
    if (capture) {
      await db.update(usersTable).set(capture).where(eq(usersTable.id, existing.id));
    }
    return { id: existing.id };
  }

  let username = generateUsername(claims);
  let attempts = 0;
  while (attempts < 10) {
    const [conflict] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.username, username));
    if (!conflict) break;
    username = generateUsername(claims);
    attempts++;
  }

  const capture = resolveEmailCapture(claims.email, { email: null, recapUnsubscribeToken: null }, randomUUID);
  const [created] = await db
    .insert(usersTable)
    // unlockAll false: accounts born after the Gentle Door get progressive
    // unlock; every pre-existing row was stamped true by the migration default.
    .values({ externalId, username, unlockAll: false, ...(capture ?? {}) })
    .returning({ id: usersTable.id });

  await seedStarterQuests(created.id);

  return created;
}

// Seed a brand-new account with a few starter quests so first-time users don't land on
// empty pages. Called only on the create path above, so it runs exactly once per account
// and never re-seeds. Best-effort: a failure here must never block account creation.
async function seedStarterQuests(userId: number): Promise<void> {
  const today = new Date().toISOString().split("T")[0]!;
  try {
    await db.insert(tasksTable).values(buildStarterQuestRows(userId, today));
  } catch (err) {
    logger.warn({ err, userId }, "Failed to seed starter quests for new user");
  }
}

router.get("/auth/user", (req: Request, res: Response) => {
  res.json(
    GetCurrentAuthUserResponse.parse({
      user: req.isAuthenticated() ? req.user : null,
    }),
  );
});

router.get("/login", async (req: Request, res: Response) => {
  const config = await getOidcConfig();
  const callbackUrl = `${getOrigin(req)}/api/callback`;

  const returnTo = getSafeReturnTo(req.query.returnTo);

  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);

  const redirectTo = oidc.buildAuthorizationUrl(config, {
    redirect_uri: callbackUrl,
    scope: "openid email profile offline_access",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "login consent",
    state,
    nonce,
  });

  setOidcCookie(res, "code_verifier", codeVerifier);
  setOidcCookie(res, "nonce", nonce);
  setOidcCookie(res, "state", state);
  setOidcCookie(res, "return_to", returnTo);

  res.redirect(redirectTo.href);
});

router.get("/callback", async (req: Request, res: Response) => {
  const config = await getOidcConfig();
  const callbackUrl = `${getOrigin(req)}/api/callback`;

  const codeVerifier = req.cookies?.code_verifier;
  const nonce = req.cookies?.nonce;
  const expectedState = req.cookies?.state;

  if (!codeVerifier || !expectedState) {
    res.redirect("/api/login");
    return;
  }

  const currentUrl = new URL(
    `${callbackUrl}?${new URL(req.url, `http://${req.headers.host}`).searchParams}`,
  );

  let tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers;
  try {
    tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedNonce: nonce,
      expectedState,
      idTokenExpected: true,
    });
  } catch {
    res.redirect("/api/login");
    return;
  }

  const returnTo = getSafeReturnTo(req.cookies?.return_to);

  res.clearCookie("code_verifier", { path: "/" });
  res.clearCookie("nonce", { path: "/" });
  res.clearCookie("state", { path: "/" });
  res.clearCookie("return_to", { path: "/" });

  const claims = tokens.claims();
  if (!claims) {
    res.redirect("/api/login");
    return;
  }

  const gameUser = await upsertGameUser(claims as unknown as Record<string, unknown>);

  const now = Math.floor(Date.now() / 1000);
  const sessionData: SessionData = {
    user: {
      id: String(claims.sub),
      email: (claims.email as string | undefined) ?? null,
      firstName: (claims.first_name as string | undefined) ?? null,
      lastName: (claims.last_name as string | undefined) ?? null,
      profileImageUrl: ((claims.profile_image_url || claims.picture) as string | undefined) ?? null,
    },
    gameUserId: gameUser.id,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expiresIn() ? now + tokens.expiresIn()! : (claims.exp as number | undefined),
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.redirect(returnTo);
});

router.post("/logout", async (req: Request, res: Response) => {
  const origin = getOrigin(req);

  const reqOrigin = req.headers["origin"];
  const reqReferer = req.headers["referer"];

  if (reqOrigin) {
    if (reqOrigin !== origin) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  } else if (reqReferer) {
    if (reqReferer !== origin && !reqReferer.startsWith(`${origin}/`)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  } else {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const config = await getOidcConfig();

  const sid = getSessionId(req);
  if (sid) {
    await clearSession(res, sid);
  }

  const endSessionUrl = oidc.buildEndSessionUrl(config, {
    client_id: process.env.OAUTH_CLIENT_ID!,
    post_logout_redirect_uri: origin,
  });

  res.redirect(endSessionUrl.href);
});

router.post(
  "/mobile-auth/token-exchange",
  async (req: Request, res: Response) => {
    const parsed = ExchangeMobileAuthorizationCodeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Missing or invalid required parameters" });
      return;
    }

    const { code, code_verifier, redirect_uri, state, nonce } = parsed.data;

    try {
      const config = await getOidcConfig();

      const callbackUrl = new URL(redirect_uri);
      callbackUrl.searchParams.set("code", code);
      callbackUrl.searchParams.set("state", state);
      callbackUrl.searchParams.set("iss", ISSUER_URL);

      const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
        pkceCodeVerifier: code_verifier,
        expectedNonce: nonce ?? undefined,
        expectedState: state,
        idTokenExpected: true,
      });

      const claims = tokens.claims();
      if (!claims) {
        res.status(401).json({ error: "No claims in ID token" });
        return;
      }

      const gameUser = await upsertGameUser(claims as unknown as Record<string, unknown>);

      const now = Math.floor(Date.now() / 1000);
      const sessionData: SessionData = {
        user: {
          id: String(claims.sub),
          email: (claims.email as string | undefined) ?? null,
          firstName: (claims.first_name as string | undefined) ?? null,
          lastName: (claims.last_name as string | undefined) ?? null,
          profileImageUrl: ((claims.profile_image_url || claims.picture) as string | undefined) ?? null,
        },
        gameUserId: gameUser.id,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expiresIn() ? now + tokens.expiresIn()! : (claims.exp as number | undefined),
      };

      const sid = await createSession(sessionData);
      res.json(ExchangeMobileAuthorizationCodeResponse.parse({ token: sid }));
    } catch (err) {
      req.log.error({ err }, "Mobile token exchange error");
      res.status(500).json({ error: "Token exchange failed" });
    }
  },
);

router.post("/mobile-auth/logout", async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  if (sid) {
    await deleteSession(sid);
  }
  res.json(LogoutMobileSessionResponse.parse({ success: true }));
});

export default router;
