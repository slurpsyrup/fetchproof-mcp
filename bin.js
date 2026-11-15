#!/usr/bin/env node
/**
 * stdio MCP bridge. Claude Desktop and other stdio clients run this process;
 * every message is posted to the Fetchproof /mcp endpoint with the caller's key.
 *
 *   FETCHPROOF_API_KEY=... FETCHPROOF_BASE_URL=https://api.fetchproof.com node mcp/bin.js
 */

const base = (process.env.FETCHPROOF_BASE_URL || "https://api.fetchproof.com").replace(/\/$/, "");
const key = process.env.FETCHPROOF_API_KEY || "";

if (!key) {
  process.stderr.write("FETCHPROOF_API_KEY is required\n");
  process.exit(1);
}

function writeMessage(value) {
  const json = Buffer.from(JSON.stringify(value));
  process.stdout.write(`Content-Length: ${json.length}\r\n\r\n`);
  process.stdout.write(json);
}

async function forward(message) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(message),
  });
  if (res.status === 202) return;
  const text = await res.text();
  if (!text) return;
  writeMessage(JSON.parse(text));
}

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
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
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      writeMessage({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      continue;
    }
    forward(message).catch((error) => {
      writeMessage({
        jsonrpc: "2.0",
        id: message?.id ?? null,
        error: { code: -32000, message: `Fetchproof MCP bridge failed: ${error?.message || error}` },
      });
    });
  }
});
