import crypto from "node:crypto";
import net from "node:net";

/**
 * A WebSocket client for ws://127.0.0.1 only, which is all Chrome's debugging port needs.
 * Node 18 and 20 have no WebSocket of their own, and this keeps the skill free of packages.
 *
 * `connect(url)` resolves to `{ send(text), onMessage(fn), onClose(fn), close() }`.
 */
export function connect(url) {
  const target = new URL(url);
  if (target.protocol !== "ws:") throw new Error("Only ws:// is supported.");
  const host = target.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error("Only a loopback WebSocket host is supported.");
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(target.port) || 80, target.hostname);
    const key = crypto.randomBytes(16).toString("base64");
    const messageHandlers = [];
    const closeHandlers = [];
    let head = Buffer.alloc(0);
    let buffer = Buffer.alloc(0);
    let upgraded = false;
    let fragments = [];

    socket.on("connect", () => {
      socket.write([
        `GET ${target.pathname}${target.search} HTTP/1.1`,
        `Host: ${target.host}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
        "\r\n"
      ].join("\r\n"));
    });

    socket.on("data", (chunk) => {
      if (!upgraded) {
        head = Buffer.concat([head, chunk]);
        const end = head.indexOf("\r\n\r\n");
        if (end < 0) return;
        const text = head.subarray(0, end).toString("latin1");
        if (!/^HTTP\/1\.1 101/.test(text)) {
          socket.destroy();
          return reject(new Error(`WebSocket refused: ${text.split("\r\n")[0]}`));
        }
        upgraded = true;
        buffer = head.subarray(end + 4);
        head = Buffer.alloc(0);
        resolve(api);
      } else {
        buffer = Buffer.concat([buffer, chunk]);
      }
      readFrames();
    });

    socket.on("error", (error) => {
      if (!upgraded) reject(error);
    });
    socket.on("close", () => {
      for (const handler of closeHandlers) handler();
    });

    function readFrames() {
      for (;;) {
        if (buffer.length < 2) return;
        const fin = (buffer[0] & 0x80) !== 0;
        const opcode = buffer[0] & 0x0f;
        let length = buffer[1] & 0x7f;
        let offset = 2;
        if (length === 126) {
          if (buffer.length < 4) return;
          length = buffer.readUInt16BE(2);
          offset = 4;
        } else if (length === 127) {
          if (buffer.length < 10) return;
          length = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }
        if (buffer.length < offset + length) return;
        const payload = buffer.subarray(offset, offset + length);
        buffer = buffer.subarray(offset + length);

        if (opcode === 0x8) {
          socket.end();
          return;
        }
        if (opcode === 0x9) {
          write(0xa, payload);
          continue;
        }
        if (opcode === 0xa) continue;
        fragments.push(payload);
        if (fin) {
          const text = Buffer.concat(fragments).toString("utf8");
          fragments = [];
          for (const handler of messageHandlers) handler(text);
        }
      }
    }

    /** Client frames are always masked. */
    function write(opcode, payload) {
      const mask = crypto.randomBytes(4);
      let header;
      if (payload.length < 126) {
        header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
      } else if (payload.length < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x80 | opcode;
        header[1] = 0x80 | 126;
        header.writeUInt16BE(payload.length, 2);
      } else {
        header = Buffer.alloc(10);
        header[0] = 0x80 | opcode;
        header[1] = 0x80 | 127;
        header.writeBigUInt64BE(BigInt(payload.length), 2);
      }
      const masked = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i += 1) masked[i] = payload[i] ^ mask[i % 4];
      socket.write(Buffer.concat([header, mask, masked]));
    }

    const api = {
      send: (text) => write(0x1, Buffer.from(text, "utf8")),
      onMessage: (fn) => messageHandlers.push(fn),
      onClose: (fn) => closeHandlers.push(fn),
      close: () => socket.destroy()
    };
  });
}
