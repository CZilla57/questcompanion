import type { PushPayload } from "./push-notifications";

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
