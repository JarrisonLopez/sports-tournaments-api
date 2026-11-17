import fs from "node:fs";

const otelKeys = [
  "OTEL_SERVICE_NAME",
  "OTEL_TRACES_EXPORTER",
  "OTEL_METRICS_EXPORTER",
  "OTEL_EXPORTER_OTLP_PROTOCOL",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_CERTIFICATE",
];

const files = [
  "k8s/aws/configmap.exp-intercloud-baseline.yaml",
  "k8s/aws/configmap.exp-intercloud-r0.yaml",
  "k8s/aws/configmap.exp-intercloud-r1.yaml",
];

for (const f of files) {
  const t = fs.readFileSync(f, "utf8");
  for (const k of otelKeys) {
    if (!t.includes(`${k}:`)) throw new Error(`${f} missing ${k}`);
  }
  if (!t.includes("https://otel-lab.local:31443")) {
    throw new Error(`${f} bad endpoint`);
  }
  if (!t.includes("149.130.165.30") || !t.includes("35.239.107.54")) {
    throw new Error(`${f} bad providers`);
  }
  if (t.includes("CHAOS_FAULT_TOKEN") || t.includes("Authorization=Basic")) {
    throw new Error(`${f} leaked secret`);
  }
  if (t.includes('OTEL_EXPORTER_OTLP_ENDPOINT: ""')) {
    throw new Error(`${f} empty otel`);
  }
}

const b = fs.readFileSync(files[0], "utf8");
const r0 = fs.readFileSync(files[1], "utf8");
const r1 = fs.readFileSync(files[2], "utf8");
if (!b.includes('RESILIENCE_ENABLED: "true"')) throw new Error("baseline res");
if (!r0.includes('RESILIENCE_ENABLED: "false"')) throw new Error("r0 res");
if (!r1.includes('RESILIENCE_ENABLED: "true"')) throw new Error("r1 res");
if (!r1.includes('HOTEL_TIMEOUT_MS: "400"')) throw new Error("r1 timeout");

const script = fs.readFileSync(
  "scripts/chaos/run_aws_intercloud_rounds.ps1",
  "utf8",
);
if (!script.includes("flujo-profile-shared.js")) {
  throw new Error("orchestrator not using shared k6 profile");
}
if (!script.includes("configmap.exp-intercloud-baseline.yaml")) {
  throw new Error("orchestrator missing baseline CM");
}
if (!script.includes("try {") || !script.includes("finally")) {
  throw new Error("orchestrator missing try/finally restore");
}

console.log("configmap-otel-baseline-orchestrator-ok");
