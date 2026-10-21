"use strict";
/**
 * 集合石房间客户端：复用 lolPing 的加密与传输实现。
 * - 房间包：scrypt 派生房间密钥，AES-256-GCM 封包（relay 上只有密文）
 * - 互联网：lolPing 的公共 Nostr 中继列表（RelayTransport）
 * - 局域网：lolPing 的 UDP 广播（LanTransport）
 * - 密语：X25519 ECDH + HKDF + AES-256-GCM（sealWhisper/openWhisper）
 */
import { randomBytes } from "node:crypto";
import {
  deriveRoomKeys, makeIdentity, seal, open, whisperKey, sealWhisper, openWhisper, xPublicKeyOf,
  type RoomKeys, type RoomIdentity,
} from "./main/roomCrypto";
import { LanTransport } from "./main/lanTransport";
import { RelayTransport } from "./main/relayTransport";

export interface RoomProfile {
  name: string;
  cls: string;
  role: string;
  [key: string]: unknown;
}

export interface RoomClientOptions {
  relayUrls?: readonly string[];
  broadcast?: boolean;
}

interface PeerInfo {
  mid: string;
  profile: RoomProfile;
  xpk: Buffer | null;
  lastSeen: number;
  path: "lan" | "internet";
}

type PacketHandler = (msg: any) => void;
type StatusHandler = (status: { lan: string; internet: string }) => void;

export class RoomClient {
  code = "";
  private keys: RoomKeys | null = null;
  private identity: RoomIdentity | null = null;
  private lan: LanTransport | null = null;
  private relay: RelayTransport | null = null;
  private mid = randomBytes(6).toString("hex");
  private profile: RoomProfile = { name: "", cls: "none", role: "dps" };
  private peers = new Map<string, PeerInfo>();
  private presenceTimer: NodeJS.Timeout | null = null;
  private status = { lan: "off", internet: "off" };
  onPacket: PacketHandler = () => {};
  onStatus: StatusHandler = () => {};

  async start(code: string, profile: RoomProfile, opts: RoomClientOptions = {}): Promise<void> {
    this.stop();
    this.code = code.toUpperCase();
    this.profile = profile;
    this.keys = await deriveRoomKeys(this.code);
    this.identity = makeIdentity(randomBytes(32));

    this.lan = new LanTransport({ broadcast: opts.broadcast !== false });
    this.lan.on("packet", (peer: any, packet: Uint8Array) => this.handle(packet, "lan"));
    this.lan.on("status", (s: string) => this.setStatus("lan", s));
    this.lan.start(this.keys);

    if (opts.relayUrls === undefined) {
      this.relay = new RelayTransport();
    } else if (opts.relayUrls.length) {
      this.relay = new RelayTransport({ urls: opts.relayUrls });
    }
    if (this.relay) {
      this.relay.on("packet", (_peer: any, packet: Uint8Array) => this.handle(packet, "internet"));
      this.relay.on("status", (s: string) => this.setStatus("internet", s));
      this.relay.start(this.keys);
    }

    this.sendPresence();
    this.presenceTimer = setInterval(() => this.sendPresence(), 10000);
    // 清理长时间无 presence 的成员
    this.presenceTimer.unref?.();
  }

  stop(): void {
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    this.presenceTimer = null;
    try { this.lan?.stop(); } catch {}
    try { this.relay?.stop(); } catch {}
    this.lan = null;
    this.relay = null;
    this.keys = null;
    this.identity = null;
    this.peers.clear();
    this.setStatus("lan", "off");
    this.setStatus("internet", "off");
  }

  private setStatus(kind: "lan" | "internet", state: string): void {
    this.status[kind] = state;
    this.onStatus({ ...this.status });
  }

  private handle(packet: Uint8Array, path: "lan" | "internet"): void {
    if (!this.keys) return;
    const plain = open(this.keys.msgKey, packet);
    if (!plain) return;
    let msg: any;
    try { msg = JSON.parse(plain.toString()); } catch { return; }
    if (!msg || msg.mid === this.mid) return;

    if (msg.type === "presence" && msg.from) {
      const xpk = msg.xpk ? Buffer.from(msg.xpk, "base64") : null;
      this.peers.set(msg.mid, { mid: msg.mid, profile: msg.from, xpk, lastSeen: Date.now(), path });
      this.onPacket({ type: "presence", from: msg.from });
      return;
    }

    if (msg.type === "whisper") {
      this.onPacket(Object.assign({}, msg, { decrypted: this.tryOpenWhisper(msg) }));
      return;
    }

    this.onPacket(msg);
  }

  /** 密语解包：只有收件人（to 匹配自己昵称或"我"标记为 to:true）才尝试。 */
  private tryOpenWhisper(msg: any): string | null {
    if (!this.identity || !msg.box) return null;
    const toMe = msg.to && String(msg.to).toLowerCase() === String(this.profile.name).toLowerCase();
    if (!toMe) return null;
    if (msg.fromXpk) {
      const theirs = xPublicKeyOf(Buffer.from(msg.fromXpk, "base64"));
      if (theirs) {
        const key = whisperKey(this.identity.xkey, theirs);
        const aad = (msg.from && msg.from.name ? msg.from.name : "?") + ":" + this.profile.name;
        const text = openWhisper(key, Buffer.from(msg.box, "base64"), aad);
        if (text !== null) return text;
      }
    }
    return null;
  }

  private raw(pkt: Uint8Array): void {
    try { this.lan?.broadcast(pkt); } catch {}
    try { this.relay?.broadcast(pkt); } catch {}
  }

  private send(msg: Record<string, unknown>): void {
    if (!this.keys) return;
    const full = Object.assign({ v: 1, mid: this.mid, from: this.profile, ts: Date.now() }, msg);
    try {
      const pkt = seal(this.keys.msgKey, Buffer.from(JSON.stringify(full)));
      this.raw(pkt);
    } catch { /* 超长包不发送 */ }
  }

  sendPresence(): void {
    if (!this.identity) return;
    this.send({ type: "presence", xpk: this.identity.xpk.toString("base64") });
  }

  sendChat(chan: string, text: string, to?: string): void {
    if (chan === "whisper" && to) {
      const peer = [...this.peers.values()].find((p) =>
        String(p.profile.name).toLowerCase() === String(to).toLowerCase() && p.xpk);
      if (this.identity && peer && peer.xpk) {
        const theirs = xPublicKeyOf(peer.xpk);
        if (theirs) {
          const key = whisperKey(this.identity.xkey, theirs);
          const aad = this.profile.name + ":" + peer.profile.name;
          const box = sealWhisper(key, text, aad);
          this.send({ type: "whisper", to: peer.profile.name, fromXpk: this.identity.xpk.toString("base64"), box: box.toString("base64") });
          return;
        }
      }
      // 对方公钥未知：退回房间密钥通道（仍加密），由对端按 to 过滤
    }
    this.send({ type: "chat", chan, text, to });
  }

  get peerList(): Array<{ name: string; cls: string; role: string; path: string }> {
    const now = Date.now();
    return [...this.peers.values()]
      .filter((p) => now - p.lastSeen < 35000)
      .map((p) => ({ name: p.profile.name, cls: p.profile.cls || "none", role: p.profile.role || "dps", path: p.path }));
  }
}
