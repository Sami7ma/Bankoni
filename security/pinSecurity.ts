import * as Crypto from 'expo-crypto';
import { scrypt } from '@noble/hashes/scrypt.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * BanKoni PIN hashing.
 *
 * New hashes use scrypt-v3 (N=1024, r=8, p=1) optimized for mobile execution (~30ms),
 * avoiding React Native bridge timer overhead.
 * scrypt-v2 and v1 are supported for backward compatibility and verified synchronously.
 *
 * A PIN is a local unlock factor, not a replacement for encrypting the SQLite
 * database and protecting its encryption key.
 */

const CURRENT_VERSION = 'scrypt-v3';
const V2_VERSION = 'scrypt-v2';
const LEGACY_VERSION = 'scrypt-v1';

const SALT_LENGTH = 16;
const DERIVED_KEY_LENGTH = 32;

// scrypt-v3 uses N=1024, r=8, p=1 for instant (~30ms) mobile execution without UI freezing.
// scrypt-v2 and v1 are retained for backward-compatible verification of existing vaults.
const CURRENT_PARAMS = { N: 1024, r: 8, p: 1, dkLen: DERIVED_KEY_LENGTH } as const;
const V2_PARAMS = { N: 2 ** 15, r: 8, p: 3, dkLen: DERIVED_KEY_LENGTH } as const;
const LEGACY_PARAMS = { N: 2 ** 15, r: 8, p: 1, dkLen: DERIVED_KEY_LENGTH } as const;

const NEW_PIN_MIN_LENGTH = 4;
const LEGACY_PIN_MIN_LENGTH = 4;
const PIN_MAX_LENGTH = 12;

export function validateNewPin(pin: string): boolean {
    return new RegExp(`^\\d{${NEW_PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(pin);
}

function isNumericPinCandidate(pin: string): boolean {
    return new RegExp(`^\\d{${LEGACY_PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(pin);
}

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
    if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) {
        throw new Error('Invalid hexadecimal value.');
    }

    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;

    let difference = 0;
    for (let i = 0; i < a.length; i += 1) {
        difference |= a[i] ^ b[i];
    }
    return difference === 0;
}

export function isHashedPin(value: string): boolean {
    return (
        value.startsWith(`${LEGACY_VERSION}$`) ||
        value.startsWith(`${V2_VERSION}$`) ||
        value.startsWith(`${CURRENT_VERSION}$`)
    );
}

/** Create a new versioned hash. Accepts legacy-length PINs only so migration can upgrade them. */
export async function hashPin(pin: string): Promise<string> {
    if (!isNumericPinCandidate(pin)) {
        throw new Error('PIN must contain 4 to 12 numeric digits.');
    }

    const salt = await Crypto.getRandomBytesAsync(SALT_LENGTH);
    const derivedKey = scrypt(utf8ToBytes(pin), salt, CURRENT_PARAMS);

    return [
        CURRENT_VERSION,
        CURRENT_PARAMS.N,
        CURRENT_PARAMS.r,
        CURRENT_PARAMS.p,
        bytesToHex(salt),
        bytesToHex(derivedKey),
    ].join('$');
}

/**
 * Verify a PIN against a versioned hash. The unversioned branch exists solely
 * for the previous app's plaintext-PIN records; successful login must replace
 * that record with a hash before opening the vault.
 */
export async function verifyPin(pin: string, storedValue: string): Promise<boolean> {
    if (!isNumericPinCandidate(pin) || typeof storedValue !== 'string' || storedValue.length === 0) {
        return false;
    }

    // Legacy database format used a plaintext PIN. Do not treat arbitrary
    // unrecognized data as a valid credential format.
    if (!isHashedPin(storedValue)) {
        return isNumericPinCandidate(storedValue) && constantTimeEqual(
            utf8ToBytes(pin),
            utf8ToBytes(storedValue),
        );
    }

    const parts = storedValue.split('$');
    if (parts.length !== 6) return false;

    const [version, nValue, rValue, pValue, saltHex, hashHex] = parts;
    const params = version === LEGACY_VERSION
        ? LEGACY_PARAMS
        : version === V2_VERSION
            ? V2_PARAMS
            : version === CURRENT_VERSION
                ? CURRENT_PARAMS
                : null;

    if (!params) return false;

    // Only accept parameter sets that this application intentionally supports.
    if (
        Number(nValue) !== params.N ||
        Number(rValue) !== params.r ||
        Number(pValue) !== params.p
    ) {
        return false;
    }

    try {
        const salt = hexToBytes(saltHex);
        const storedHash = hexToBytes(hashHex);

        if (salt.length !== SALT_LENGTH || storedHash.length !== DERIVED_KEY_LENGTH) {
            return false;
        }

        const derivedKey = scrypt(utf8ToBytes(pin), salt, params);
        return constantTimeEqual(derivedKey, storedHash);
    } catch {
        return false;
    }
}

/** True only for hashes created with the current parameter set. */
export function isCurrentPinHash(value: string): boolean {
    return value.startsWith(`${CURRENT_VERSION}$`);
}
