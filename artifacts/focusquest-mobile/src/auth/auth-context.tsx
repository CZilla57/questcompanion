import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import * as AuthSession from "expo-auth-session";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import Constants from "expo-constants";
import { deriveChallenge, randomString } from "./pkce";
import { resolveAuthConfig } from "./auth-config";
import { exchangeCode } from "./token-exchange";
import { saveToken, getToken, clearToken } from "./token-store";
import { registerForPush, deregisterPush } from "../push/register-device";

WebBrowser.maybeCompleteAuthSession();

let pushToken: string | null = null;

type Status = "loading" | "authed" | "anon";
interface AuthValue {
  status: Status;
  login(): Promise<void>;
  logout(): Promise<void>;
}
const AuthContext = createContext<AuthValue | null>(null);

const REDIRECT_URI = AuthSession.makeRedirectUri({ scheme: "focusquest", path: "auth" });

async function sha256Bytes(input: string): Promise<Uint8Array> {
  const hex = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    getToken().then((t) => setStatus(t ? "authed" : "anon"));
  }, []);

  async function login() {
    console.log("Auth redirect URI:", REDIRECT_URI);
    try {
      const { issuer, clientId } = resolveAuthConfig(Constants.expoConfig?.extra);

      const discovery = await AuthSession.fetchDiscoveryAsync(issuer);
      const verifier = randomString(Crypto.getRandomBytes(32));
      const state = randomString(Crypto.getRandomBytes(16));
      const nonce = randomString(Crypto.getRandomBytes(16));
      const challenge = await deriveChallenge(verifier, sha256Bytes);

      const req = new AuthSession.AuthRequest({
        clientId,
        redirectUri: REDIRECT_URI,
        responseType: "code",
        scopes: ["openid", "email", "profile", "offline_access"],
        state,
        usePKCE: false,
        extraParams: { nonce, code_challenge: challenge, code_challenge_method: "S256" },
      });

      const result = await req.promptAsync(discovery);
      if (result.type !== "success" || !result.params.code) {
        console.log("Auth0 login did not complete:", result.type);
        return;
      }

      const token = await exchangeCode({
        code: result.params.code,
        code_verifier: verifier,
        redirect_uri: REDIRECT_URI,
        state,
        nonce,
      });
      await saveToken(token);
      setStatus("authed");

      // Push registration must never break a successful login.
      registerForPush()
        .then((t) => {
          pushToken = t;
        })
        .catch((err) => {
          console.log("Push registration failed:", err);
        });
    } catch (err) {
      console.log("Auth0 login failed:", err);
    }
  }

  async function logout() {
    if (pushToken) {
      try {
        await deregisterPush(pushToken);
      } catch (err) {
        console.log("Push deregistration failed:", err);
      } finally {
        pushToken = null;
      }
    }
    await clearToken();
    setStatus("anon");
  }

  return <AuthContext.Provider value={{ status, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
