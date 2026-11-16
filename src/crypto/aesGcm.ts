import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTE_LENGTH = 12;
const AUTH_TAG_BYTE_LENGTH = 16;

export class CryptoService {
  private readonly keyBuffer: Buffer;

  constructor(masterKeyRaw: string) {
    if (!masterKeyRaw || masterKeyRaw.trim().length === 0) {
      throw new Error('CRITICAL: MASTER_ENCRYPTION_KEY cannot be empty.');
    }
    const trimmed = masterKeyRaw.trim();
    if (/^[a-fA-F0-9]{64}$/.test(trimmed)) {
      this.keyBuffer = Buffer.from(trimmed, 'hex');
    } else {
      this.keyBuffer = crypto.createHash('sha256').update(trimmed, 'utf8').digest();
    }
    if (this.keyBuffer.byteLength !== 32) {
      throw new Error('CRITICAL: Derived AES-256-GCM key must be exactly 32 bytes.');
    }
  }

  /**
   * Encrypts plaintext using AES-256-GCM.
   * Output format: `v1:<iv_base64>:<authTag_base64>:<ciphertext_base64>`
   */
  public encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(IV_BYTE_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.keyBuffer, iv, {
      authTagLength: AUTH_TAG_BYTE_LENGTH,
    });
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `v1:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  /**
   * Decrypts an AES-256-GCM payload produced by `encrypt()`.
   * Throws on any tampering, invalid tag, or malformed envelope.
   */
  public decrypt(envelope: string): string {
    const parts = envelope.split(':');
    if (parts.length !== 4 || parts[0] !== 'v1') {
      throw new Error('Malformed AES-256-GCM ciphertext envelope.');
    }
    const iv = Buffer.from(parts[1], 'base64');
    const authTag = Buffer.from(parts[2], 'base64');
    const ciphertext = Buffer.from(parts[3], 'base64');

    if (iv.byteLength !== IV_BYTE_LENGTH || authTag.byteLength !== AUTH_TAG_BYTE_LENGTH) {
      throw new Error('Invalid IV or AuthTag length in AES-256-GCM envelope.');
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, this.keyBuffer, iv, {
      authTagLength: AUTH_TAG_BYTE_LENGTH,
    });
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  }

  /**
   * Signs an administrative session token using HMAC-SHA256.
   */
  public static signAdminToken(
    payload: { adminId: number; role: string; exp: number },
    secret: string
  ): string {
    const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
    return `${data}.${sig}`;
  }

  /**
   * Verifies an administrative session token using timing-safe comparison.
   */
  public static verifyAdminToken(
    token: string,
    secret: string
  ): { adminId: number; role: string; exp: number } | null {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [data, sig] = parts;
    const expectedSig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.byteLength !== expBuf.byteLength || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    try {
      const decoded = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as {
        adminId: number;
        role: string;
        exp: number;
      };
      if (Date.now() > decoded.exp) return null;
      return decoded;
    } catch {
      return null;
    }
  }
}

/**
 * Masks sensitive PII (Phone numbers, National IDs, Bank Cards, IBANs, Emails, Names)
 * so raw user queries never leak in structured logs or default Admin views.
 */
export function maskPII(rawInput: string, category?: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) return '***';

  if (category === 'BANK_CARD' || /^\d{16}$/.test(trimmed)) {
    return `${trimmed.slice(0, 6)}******${trimmed.slice(-4)}`;
  }
  if (category === 'IBAN' || /^\d{24}$/.test(trimmed)) {
    return `${trimmed.slice(0, 4)}****************${trimmed.slice(-4)}`;
  }
  if (category === 'NATIONAL_ID' || /^\d{10}$/.test(trimmed)) {
    return `${trimmed.slice(0, 3)}****${trimmed.slice(-3)}`;
  }
  if (category === 'PHONE' || /^(\+98|98|09|\+79|79)\d{8,10}$/.test(trimmed)) {
    return `${trimmed.slice(0, 4)}****${trimmed.slice(-3)}`;
  }
  if (category === 'EMAIL' || trimmed.includes('@')) {
    if (trimmed.startsWith('@')) {
      return trimmed.length > 4 ? `${trimmed.slice(0, 3)}***${trimmed.slice(-2)}` : '@***';
    }
    const [local, domain] = trimmed.split('@');
    if (!local || !domain) return '***@***';
    const maskedLocal = local.length > 2 ? `${local.slice(0, 2)}***` : `${local[0] ?? '*'}***`;
    return `${maskedLocal}@${domain}`;
  }
  if (category === 'FULL_NAME') {
    const words = trimmed.split(/\s+/);
    return words.map((w) => (w.length > 1 ? `${w[0]}***` : '*')).join(' ');
  }
  if (trimmed.length <= 4) {
    return '****';
  }
  return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`;
}
