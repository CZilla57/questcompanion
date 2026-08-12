import { customFetch } from "@workspace/api-client-react";

export interface ExchangeParams {
  code: string;
  code_verifier: string;
  redirect_uri: string;
  state: string;
  nonce: string | null;
}

// Posts to the existing provider-agnostic endpoint; returns the FocusQuest
// session token (see artifacts/api-server/src/routes/auth.ts token-exchange).
export async function exchangeCode(params: ExchangeParams): Promise<string> {
  const res = await customFetch<{ token: string }>(
    "/api/mobile-auth/token-exchange",
    { method: "POST", body: JSON.stringify(params) },
  );
  return res.token;
}
