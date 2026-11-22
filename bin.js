#!/usr/bin/env node
/**
 * @fetchproof/mcp — stdio MCP server for the Fetchproof public-data API.
 *
 *   FETCHPROOF_API_KEY=... npx @fetchproof/mcp
 *
 * initialize and tools/list work without a key. tools/call needs FETCHPROOF_API_KEY.
 * Optional: FETCHPROOF_BASE_URL (default https://api.fetchproof.com), FETCHPROOF_TIMEOUT_MS.
 */

import { startStdio } from "./src/stdio.js";

const flag = process.argv[2];
if (flag === "--help" || flag === "-h") {
  process.stdout.write(`@fetchproof/mcp — stdio MCP server for the Fetchproof API

Usage:
  FETCHPROOF_API_KEY=fp_... npx @fetchproof/mcp

Environment:
  FETCHPROOF_API_KEY      Required for tools/call (not for initialize or tools/list)
  FETCHPROOF_BASE_URL     Default https://api.fetchproof.com
  FETCHPROOF_TIMEOUT_MS   Default 60000

Docs: https://docs.fetchproof.com/mcp
`);
  process.exit(0);
}
if (flag === "--version" || flag === "-v") {
  process.stdout.write("0.1.0\n");
  process.exit(0);
}

startStdio();
