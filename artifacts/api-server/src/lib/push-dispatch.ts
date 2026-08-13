import type { PushPayload } from "./push-notifications";
import { dispatchToUser, type DispatchDeps } from "./device-dispatch";
import { logger } from "./logger";

export interface WebSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface WebPushDeps {
  listSubscriptions(userId: number): Promise<WebSubscription[]>;
  send(sub: WebSubscription, payload: PushPayload): Promise<boolean>;
  remove(endpoint: string): Promise<void>;
}

/** Deliver to every web-push subscription for a user, pruning any that fail
 * (an expired/gone subscription). Returns the number of successful sends. */
export async function sendWebToUser(
  userId: number,
  payload: PushPayload,
  deps: WebPushDeps,
): Promise<number> {
  const subs = await deps.listSubscriptions(userId);
  let sent = 0;
  for (const sub of subs) {
    const ok = await deps.send(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      payload,
    );
    if (ok) sent += 1;
    else await deps.remove(sub.endpoint);
  }
  return sent;
}

/** Fan out a push to all of a user's channels, best-effort: logs the result
 * and never throws, so a caller's control flow (e.g. the scheduler's
 * spacing/budget claim) is never rolled back by a delivery hiccup. */
export async function bestEffortDispatch(
  userId: number,
  payload: PushPayload,
  deps: DispatchDeps,
): Promise<void> {
  try {
    const result = await dispatchToUser(deps, userId, payload);
    logger.info({ userId, ...result }, "Dispatched push to user");
  } catch (err) {
    logger.error({ err, userId }, "Push dispatch failed");
  }
}
