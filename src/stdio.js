/**
 * MCP stdio transport. Official MCP messages are newline-delimited JSON.
 * Content-Length (LSP-style) framing is also accepted so older clients still work.
 * Logs go to stderr only; stdout is JSON-RPC.
 */

import { handleMessage } from "./server.js";

export function writeNdjson(value, stdout = process.stdout) {
  stdout.write(`${JSON.stringify(value)}\n`);
}

export function writeContentLength(value, stdout = process.stdout) {
  const json = Buffer.from(JSON.stringify(value));
  stdout.write(`Content-Length: ${json.length}\r\n\r\n`);
  stdout.write(json);
}

function looksLikeContentLength(buffer) {
  let i = 0;
  while (i < buffer.length && (buffer[i] === 0x20 || buffer[i] === 0x0a || buffer[i] === 0x0d || buffer[i] === 0x09)) i++;
  const start = buffer.slice(i, i + 64).toString("utf8");
  return /^content-length\s*:/i.test(start);
}

export function attachStdio({ stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, handler = handleMessage } = {}) {
  let buffer = Buffer.alloc(0);
  let framing = null; // "ndjson" | "content-length"
  const reply = (value) => {
    if (value == null) return;
    if (framing === "content-length") writeContentLength(value, stdout);
    else writeNdjson(value, stdout);
  };

  async function onMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      reply({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    try {
      const result = await handler(message);
      if (Array.isArray(result)) {
        for (const item of result) reply(item);
      } else {
        reply(result);
      }
    } catch (error) {
      stderr.write(`fetchproof-mcp: ${error?.message || error}\n`);
      reply({
        jsonrpc: "2.0",
        id: message?.id ?? null,
        error: { code: -32000, message: `Fetchproof MCP server failed: ${error?.message || error}` },
      });
    }
  }

  function consume() {
    for (;;) {
      if (!buffer.length) return;
      if (framing == null) {
        if (looksLikeContentLength(buffer)) framing = "content-length";
        else if (buffer.includes(0x0a) || buffer.includes(0x7b) /* { */) framing = "ndjson";
        else return;
      }
      if (framing === "content-length") {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const header = buffer.slice(0, headerEnd).toString("utf8");
        const match = /Content-Length:\s*(\d+)/i.exec(header);
        if (!match) {
          buffer = buffer.slice(headerEnd + 4);
          continue;
        }
        const length = Number(match[1]);
        const start = headerEnd + 4;
        if (buffer.length < start + length) return;
        const raw = buffer.slice(start, start + length).toString("utf8");
        buffer = buffer.slice(start + length);
        onMessage(raw);
        continue;
      }
      const nl = buffer.indexOf("\n");
      if (nl < 0) return;
      const line = buffer.slice(0, nl).toString("utf8").replace(/\r$/, "");
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      onMessage(line);
    }
  }

  stdin.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    consume();
  });
  stdin.on("end", () => consume());
  return { consume, get framing() { return framing; } };
}

export function startStdio(options) {
  process.stdin.resume();
  attachStdio(options);
}
