import {
  createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, randomBytes, scrypt, sign, verify,
  type KeyObject,
} from 'node:crypto';

/** Every room packet: format byte, nonce, AES-256-GCM ciphertext and tag. Larger packets are never sent or read. */
export const MAX_PACKET = 1200;
const FORMAT = 0x01;
const NONCE = 12;
const TAG = 16;
const OVERHEAD = 1 + NONCE + TAG;
const AAD = Buffer.from([FORMAT]);

export interface RoomKeys {
  /** Encrypts every room message. Never leaves the main process. */
  msgKey: Buffer;
  /** The relay topic: 64 hex characters that say nothing without the code. */
  relayTopic: string;
}

/** Room code → keys. scrypt makes guessing a code from a relay topic impractical; HKDF gives each key one job. */
export function deriveRoomKeys(canonical: string): Promise<RoomKeys> {
  return new Promise((resolve, reject) => {
    scrypt(canonical, 'lolping/room/v1', 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, master) => {
      if (err) return reject(err);
      const sub = (info: string): Buffer => Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), info, 32));
      // "sig-room" dates from a WebRTC design; kept so the keys, and the test vectors, stay the same.
      resolve({ msgKey: sub('msg'), relayTopic: sub('sig-room').toString('hex') });
    });
  });
}

export function seal(key: Buffer, plain: Uint8Array): Buffer {
  if (plain.length + OVERHEAD > MAX_PACKET) throw new Error('room message too large');
  const nonce = randomBytes(NONCE);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(AAD);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([AAD, nonce, body, cipher.getAuthTag()]);
}

/** The plaintext, or null for anything that isn't a packet sealed with this key. */
export function open(key: Buffer, packet: Uint8Array): Buffer | null {
  if (packet.length < OVERHEAD || packet.length > MAX_PACKET || packet[0] !== FORMAT) return null;
  const buf = Buffer.from(packet.buffer, packet.byteOffset, packet.length);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(1, 1 + NONCE));
    decipher.setAAD(AAD);
    decipher.setAuthTag(buf.subarray(buf.length - TAG));
    return Buffer.concat([decipher.update(buf.subarray(1 + NONCE, buf.length - TAG)), decipher.final()]);
  } catch {
    return null;
  }
}

/** A member's signing key for one room session: raw Ed25519 public key, plus a separate X25519 key for whisper ECDH. */
export interface RoomIdentity {
  pk: Buffer;
  key: KeyObject;
  /** Raw X25519 public key announced in presence; only the matching private key can open a whisper to us. */
  xpk: Buffer;
  xkey: KeyObject;
}

// DER wrappers that turn a raw 32-byte Ed25519 seed or public key into what node:crypto imports.
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
// The X25519 equivalents (OID 1.3.101.110). The whisper key grows from a hashed, domain-separated seed.
const X_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');
const X_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');

/** The identity grown from a 32-byte seed; the caller passes fresh random bytes, tests a fixed seed. */
export function makeIdentity(seed: Uint8Array): RoomIdentity {
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  const spki = createPublicKey(key).export({ format: 'der', type: 'spki' });
  const xSeed = createHash('sha256').update(seed).update('meetingstone/x25519').digest();
  const xkey = createPrivateKey({ key: Buffer.concat([X_PKCS8_PREFIX, xSeed]), format: 'der', type: 'pkcs8' });
  const xSpki = createPublicKey(xkey).export({ format: 'der', type: 'spki' });
  return {
    pk: spki.subarray(SPKI_PREFIX.length),
    key,
    xpk: xSpki.subarray(X_SPKI_PREFIX.length),
    xkey,
  };
}

/** A member's peer id: the first 16 hex characters of SHA-256 of their public key, so nobody else can claim it. */
export const peerIdOf = (pk: Uint8Array): string => createHash('sha256').update(pk).digest('hex').slice(0, 16);

/** The public key a presence announced, or null when it isn't one. */
export function publicKeyOf(pk: Uint8Array): KeyObject | null {
  if (pk.length !== 32) return null;
  try {
    return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, pk]), format: 'der', type: 'spki' });
  } catch {
    return null;
  }
}

/** The X25519 key a presence announced, or null when it isn't 32 bytes. */
export function xPublicKeyOf(pk: Uint8Array): KeyObject | null {
  if (pk.length !== 32) return null;
  try {
    return createPublicKey({ key: Buffer.concat([X_SPKI_PREFIX, pk]), format: 'der', type: 'spki' });
  } catch {
    return null;
  }
}

/** X25519 shared secret → a fresh AES-256-GCM key. The peer's X25519 key was proved by their signed presence. */
export function whisperKey(ours: KeyObject, theirs: KeyObject): Buffer {
  const shared = diffieHellman({ privateKey: ours, publicKey: theirs });
  return Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), 'meetingstone/whisper/v1', 32));
}

/** AES-256-GCM: nonce, ciphertext, tag. `aad` binds the box to sender → recipient. */
export function sealWhisper(key: Buffer, text: string, aad: string): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, body, cipher.getAuthTag()]);
}

/** The plaintext, or null when this box wasn't sealed for us with that AAD. */
export function openWhisper(key: Buffer, box: Buffer, aad: string): string | null {
  if (box.length < 29) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, box.subarray(0, 12));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(box.subarray(box.length - 16));
    return Buffer.concat([decipher.update(box.subarray(12, box.length - 16)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** The signature over an encoded message, in base64 (88 characters). */
export const signBody = (id: RoomIdentity, body: Uint8Array): string => sign(null, body, id.key).toString('base64');

export function verifyBody(pk: KeyObject, body: Uint8Array, sig: string): boolean {
  const raw = Buffer.from(sig, 'base64');
  if (raw.length !== 64) return false;
  try {
    return verify(null, body, pk, raw);
  } catch {
    return false;
  }
}
