export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  // btoa exists in the RN/Hermes runtime and in Node's test env.
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function deriveChallenge(
  verifier: string,
  sha256: (input: string) => Promise<Uint8Array>,
): Promise<string> {
  return base64UrlEncode(await sha256(verifier));
}

export function randomString(bytes: Uint8Array): string {
  return base64UrlEncode(bytes);
}
