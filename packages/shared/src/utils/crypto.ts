import crypto from "node:crypto";

const NEW_PREFIX = "v2:";
const SALT_LEN = 16;
const IV_LEN = 12; // GCM standard
const AUTH_TAG_LEN = 16;
const KEY_LEN = 32; // AES-256
const SCRYPT_N = 16384; // cost parameter (2^14)

// --- new encrypt (AES-256-GCM, random salt + random IV) ---

export const encrypt = (data: string, password: string): string => {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = crypto.scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N });
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(data, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag();
  // pack: salt + iv + authTag + ciphertext (all binary, then base64)
  const packed = Buffer.concat([salt, iv, authTag, Buffer.from(encrypted, "base64")]);
  return NEW_PREFIX + packed.toString("base64");
};

// --- decrypt (auto-detect old CBC vs new GCM format) ---

export const decrypt = (encryptedData: string, password: string): string => {
  if (encryptedData.startsWith(NEW_PREFIX)) {
    return decryptNew(encryptedData, password);
  }
  return decryptLegacy(encryptedData, password);
};

// --- internal helpers ---

function decryptNew(payload: string, password: string): string {
  const packed = Buffer.from(payload.slice(NEW_PREFIX.length), "base64");
  const salt = packed.subarray(0, SALT_LEN);
  const iv = packed.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const authTag = packed.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + AUTH_TAG_LEN);
  const ciphertext = packed.subarray(SALT_LEN + IV_LEN + AUTH_TAG_LEN);
  const key = crypto.scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N });
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext.toString("base64"), "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function decryptLegacy(encryptedData: string, password: string): string {
  // Original implementation: AES-256-CBC, fixed salt "salt", zero IV
  const key = crypto.scryptSync(password, "salt", 32);
  const iv = Buffer.alloc(16, 0);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(encryptedData, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
