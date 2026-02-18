const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(base64: string) {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function deriveBits(password: string, salt: Uint8Array) {
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );

  return crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: toArrayBuffer(salt),
      iterations: 150000,
      hash: "SHA-256",
    },
    passwordKey,
    256
  );
}

export async function deriveAesKey(password: string, saltBase64: string) {
  const salt = base64ToBytes(saltBase64);
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toArrayBuffer(salt),
      iterations: 150000,
      hash: "SHA-256",
    },
    passwordKey,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function createMasterSecret(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await deriveBits(password, salt);
  const digest = await crypto.subtle.digest("SHA-256", bits);
  return {
    salt: bytesToBase64(salt),
    verifier: bytesToBase64(new Uint8Array(digest)),
  };
}

export async function validateMasterSecret(password: string, saltBase64: string, verifier: string) {
  const bits = await deriveBits(password, base64ToBytes(saltBase64));
  const digest = await crypto.subtle.digest("SHA-256", bits);
  const check = bytesToBase64(new Uint8Array(digest));
  return check === verifier;
}

export async function encryptText(key: CryptoKey, plainText: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plainText)
  );

  return {
    iv: bytesToBase64(iv),
    cipher: bytesToBase64(new Uint8Array(encrypted)),
  };
}

export async function decryptText(
  key: CryptoKey,
  payload: {
    iv: string;
    cipher: string;
  }
) {
  const iv = base64ToBytes(payload.iv);
  const cipher = base64ToBytes(payload.cipher);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return decoder.decode(decrypted);
}

export function packEncrypted(payload: { iv: string; cipher: string }) {
  return JSON.stringify(payload);
}

export function unpackEncrypted(value: string) {
  const parsed = JSON.parse(value) as { iv: string; cipher: string };
  return parsed;
}
