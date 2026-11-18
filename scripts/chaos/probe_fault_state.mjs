#!/usr/bin/env node
/** Uso: node scripts/chaos/probe_fault_state.mjs expect=false|true */
const base = (process.env.SPORTS_BASE_URL || "http://127.0.0.1:8080").replace(
  /\/+$/,
  "",
);
const expectEnabled = (process.argv[2] || "expect=false").split("=")[1] === "true";

const res = await fetch(`${base}/chaos/hotel-latency`);
const json = await res.json();
const ok = res.status === 200 && json.enabled === expectEnabled;
console.log(JSON.stringify({ ok, expectEnabled, state: json }));
process.exit(ok ? 0 : 1);
