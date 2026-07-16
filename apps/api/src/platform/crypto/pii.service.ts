import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

/**
 * Column-level encryption for PAN and bank account numbers (TR-52).
 *
 * AES-256-GCM: authenticated, so a tampered ciphertext fails to decrypt rather
 * than silently producing garbage that we might then write to a bank file.
 *
 * NOT ENCRYPTED HERE, deliberately:
 *   - Aadhaar. We do not store it at all (OPEN.md D-4). The Aadhaar Act sharply
 *     restricts private entities holding Aadhaar numbers, and encrypting an
 *     unlawful record does not make it lawful. PF filings need the UAN.
 *   - UAN and ESIC number. Statutory identifiers, not secrets — they appear on
 *     every ECR filing and payslip.
 *
 * PRODUCTION: the key comes from cloud KMS, with a per-tenant data key
 * (envelope encryption), so one tenant's compromised key does not expose
 * another's. This implementation reads a single key from the environment, which
 * is fine for development and NOT fine for production. Tracked in OPEN.md.
 */
@Injectable()
export class PiiService {
  private readonly key: Buffer;

  constructor(private readonly config: ConfigService) {
    const hex = this.config.getOrThrow<string>('PII_ENCRYPTION_KEY');
    // Accept a hex key of any length by hashing to exactly 32 bytes, so a short
    // dev key is usable without silently truncating to a weaker one.
    this.key = createHash('sha256').update(hex).digest();
  }

  /** -> "v1:<iv>:<authTag>:<ciphertext>", all base64. Versioned for key rotation. */
  encrypt(plaintext: string): string {
    const iv = randomBytes(12); // 96-bit nonce, the GCM standard
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [
      'v1',
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  decrypt(encoded: string): string {
    const [version, ivB64, tagB64, dataB64] = encoded.split(':');
    if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
      throw new Error('malformed ciphertext');
    }

    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));

    // Throws if the ciphertext was tampered with. That is the point of GCM:
    // we would rather fail than write a corrupted account number to a NEFT file.
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  /**
   * The last 4 characters, stored in the clear alongside the ciphertext.
   *
   * This is what makes the common case cheap AND safe: a list of 200 employees
   * showing masked PANs performs ZERO decryptions. Decryption is an audited
   * event (TR-52) — a list view must not generate 200 audit entries, and it
   * must not need the key at all.
   */
  static last4(value: string): string {
    return value.slice(-4);
  }
}
