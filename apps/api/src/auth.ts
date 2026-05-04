import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

const PASSWORD_KEY_LEN = 64;
const TOKEN_BYTES = 32;

function asBase64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = (await scrypt(password, salt, PASSWORD_KEY_LEN)) as Buffer;
  return `scrypt$1$${asBase64Url(salt)}$${asBase64Url(derivedKey)}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, version, saltEncoded, keyEncoded] = encoded.split("$");

  if (algorithm !== "scrypt" || version !== "1" || !saltEncoded || !keyEncoded) {
    return false;
  }

  const salt = fromBase64Url(saltEncoded);
  const expectedKey = fromBase64Url(keyEncoded);
  const actualKey = (await scrypt(password, salt, expectedKey.length)) as Buffer;

  if (actualKey.length !== expectedKey.length) {
    return false;
  }

  return timingSafeEqual(actualKey, expectedKey);
}

export function createSessionToken(): string {
  return asBase64Url(randomBytes(TOKEN_BYTES));
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function getSessionExpiry(days = Number(process.env.SESSION_TTL_DAYS ?? 7)): Date {
  const ttlDays = Number.isFinite(days) && days > 0 ? days : 7;
  const expiresAt = new Date();
  expiresAt.setUTCDate(expiresAt.getUTCDate() + ttlDays);
  return expiresAt;
}
