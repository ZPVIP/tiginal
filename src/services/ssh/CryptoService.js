"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CryptoService = void 0;
exports.getCrypto = getCrypto;
const crypto = __importStar(require("crypto"));
const argon2_1 = __importDefault(require("argon2"));
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
class CryptoService {
    encryptionKey = null;
    verificationHash = null;
    /**
     * Derive encryption and verification keys from password using Argon2id
     */
    async deriveKeys(password, salt) {
        // Derive master key using Argon2id
        const masterKey = await argon2_1.default.hash(password, {
            salt,
            type: argon2_1.default.argon2id,
            memoryCost: ARGON2_MEMORY,
            timeCost: ARGON2_TIME,
            parallelism: ARGON2_PARALLELISM,
            raw: true,
            hashLength: 64, // 512 bits for two 256-bit keys
        });
        // Split into encryption and verification keys using HKDF
        const encryptionKey = crypto.hkdfSync('sha256', masterKey, Buffer.alloc(0), // no salt for HKDF
        Buffer.from('encryption'), 32);
        const verificationKey = crypto.hkdfSync('sha256', masterKey, Buffer.alloc(0), Buffer.from('verification'), 32);
        return {
            encryptionKey: Buffer.from(encryptionKey),
            verificationKey: Buffer.from(verificationKey),
        };
    }
    /**
     * Generate a random salt for key derivation
     */
    generateSalt() {
        return crypto.randomBytes(SALT_LENGTH);
    }
    /**
     * Hash the verification key for storage
     */
    hashVerificationKey(verificationKey) {
        return crypto.createHash('sha256').update(verificationKey).digest('hex');
    }
    /**
     * Initialize the crypto service with a password
     * Returns { salt, verificationHash } for first-time setup
     * Or verifies password for subsequent uses
     */
    async initialize(password, existingSalt, existingVerificationHash) {
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
    isUnlocked() {
        return this.encryptionKey !== null;
    }
    /**
     * Lock the service (clear keys from memory)
     */
    lock() {
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
    encrypt(plaintext) {
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
    decrypt(ciphertext) {
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
exports.CryptoService = CryptoService;
// Singleton instance
let cryptoInstance = null;
function getCrypto() {
    if (!cryptoInstance) {
        cryptoInstance = new CryptoService();
    }
    return cryptoInstance;
}
