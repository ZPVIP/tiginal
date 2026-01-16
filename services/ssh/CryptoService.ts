import * as crypto from 'crypto';
import argon2 from 'argon2';

// Encryption constants
const SALT_LENGTH = 32;
const IV_LENGTH = 12; // 96 bits for ChaCha20-Poly1305
const TAG_LENGTH = 16;

// Argon2id parameters (OWASP recommended)
const ARGON2_MEMORY = 65536; // 64 MB
const ARGON2_TIME = 3;
const ARGON2_PARALLELISM = 1;

/**
 * Cryptographic service for encrypting/decrypting sensitive data
 * Uses Argon2id for key derivation and ChaCha20-Poly1305 for encryption
 */
export class CryptoService {
  private encryptionKey: Buffer | null = null;
  private verificationHash: string | null = null;

  /**
   * Derive encryption and verification keys from password using Argon2id
   */
  async deriveKeys(password: string, salt: Buffer): Promise<{
    encryptionKey: Buffer;
    verificationKey: Buffer;
  }> {
    // Derive master key using Argon2id
    const masterKey = await argon2.hash(password, {
      salt,
      type: argon2.argon2id,
      memoryCost: ARGON2_MEMORY,
      timeCost: ARGON2_TIME,
      parallelism: ARGON2_PARALLELISM,
      raw: true,
      hashLength: 64, // 512 bits for two 256-bit keys
    });

    // Split into encryption and verification keys using HKDF
    const encryptionKey = crypto.hkdfSync(
      'sha256',
      masterKey,
      Buffer.alloc(0), // no salt for HKDF
      Buffer.from('encryption'),
      32
    );

    const verificationKey = crypto.hkdfSync(
      'sha256',
      masterKey,
      Buffer.alloc(0),
      Buffer.from('verification'),
      32
    );

    return {
      encryptionKey: Buffer.from(encryptionKey),
      verificationKey: Buffer.from(verificationKey),
    };
  }

  /**
   * Generate a random salt for key derivation
   */
  generateSalt(): Buffer {
    return crypto.randomBytes(SALT_LENGTH);
  }

  /**
   * Hash the verification key for storage
   */
  hashVerificationKey(verificationKey: Buffer): string {
    return crypto.createHash('sha256').update(verificationKey).digest('hex');
  }

  /**
   * Initialize the crypto service with a password
   * Returns { salt, verificationHash } for first-time setup
   * Or verifies password for subsequent uses
   */
  async initialize(
    password: string,
    existingSalt?: Buffer,
    existingVerificationHash?: string
  ): Promise<{ salt: Buffer; verificationHash: string; isNew: boolean }> {
    const salt = existingSalt || this.generateSalt();
    const { encryptionKey, verificationKey } = await this.deriveKeys(password, salt);
    const verificationHash = this.hashVerificationKey(verificationKey);

    // If we have existing verification hash, check if password is correct
    if (existingVerificationHash) {
      if (verificationHash !== existingVerificationHash) {
        throw new Error('Invalid password');
      }
    }

    // Store keys in memory
    this.encryptionKey = encryptionKey;
    this.verificationHash = verificationHash;

    return {
      salt,
      verificationHash,
      isNew: !existingVerificationHash,
    };
  }

  /**
   * Check if the service is unlocked
   */
  isUnlocked(): boolean {
    return this.encryptionKey !== null;
  }

  /**
   * Lock the service (clear keys from memory)
   */
  lock(): void {
    if (this.encryptionKey) {
      this.encryptionKey.fill(0);
      this.encryptionKey = null;
    }
    this.verificationHash = null;
  }

  /**
   * Encrypt plaintext using ChaCha20-Poly1305
   * Returns base64 encoded string: iv + tag + ciphertext
   */
  encrypt(plaintext: string): string {
    if (!this.encryptionKey) {
      throw new Error('Crypto service not unlocked');
    }

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('chacha20-poly1305', this.encryptionKey, iv, {
      authTagLength: TAG_LENGTH,
    });

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    const result = Buffer.concat([iv, tag, encrypted]);
    return result.toString('base64');
  }

  /**
   * Decrypt ciphertext using ChaCha20-Poly1305
   */
  decrypt(ciphertext: string): string {
    if (!this.encryptionKey) {
      throw new Error('Crypto service not unlocked');
    }

    const data = Buffer.from(ciphertext, 'base64');

    const iv = data.subarray(0, IV_LENGTH);
    const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = data.subarray(IV_LENGTH + TAG_LENGTH);

    const decipher = crypto.createDecipheriv('chacha20-poly1305', this.encryptionKey, iv, {
      authTagLength: TAG_LENGTH,
    });
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }
}

// Singleton instance
let cryptoInstance: CryptoService | null = null;

export function getCrypto(): CryptoService {
  if (!cryptoInstance) {
    cryptoInstance = new CryptoService();
  }
  return cryptoInstance;
}
