const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// Pure byte-to-base64url encoder operating directly on the Uint8Array.
// Hermes (React Native's JS engine) does not provide a global `btoa`, so we
// avoid it entirely - no btoa, no Buffer, no native deps.
export function base64UrlEncode(bytes: Uint8Array): string {
  let output = "";
  let i = 0;
  for (; i + 3 <= bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    output += BASE64URL_ALPHABET[b0 >> 2];
    output += BASE64URL_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    output += BASE64URL_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)];
    output += BASE64URL_ALPHABET[b2 & 0x3f];
  }

  const remaining = bytes.length - i;
  if (remaining === 1) {
    const b0 = bytes[i];
    output += BASE64URL_ALPHABET[b0 >> 2];
    output += BASE64URL_ALPHABET[(b0 & 0x03) << 4];
  } else if (remaining === 2) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    output += BASE64URL_ALPHABET[b0 >> 2];
    output += BASE64URL_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    output += BASE64URL_ALPHABET[(b1 & 0x0f) << 2];
  }

  return output;
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
