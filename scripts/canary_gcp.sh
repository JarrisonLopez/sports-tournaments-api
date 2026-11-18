#!/usr/bin/env bash
# Primera ejecución autorizada de sports-demo-api. Las pruebas no lo invocan.
set -euo pipefail

: "${PROJECT_ID:?}"
: "${REGION:?}"
: "${SERVICE:?}"
: "${OPERATION:?}"

if [ "${CANARY_GCP_EXECUTION:-}" != "authorized" ]; then
  echo "bloqueo: ejecución GCP no autorizada en este proceso" >&2
  exit 1
fi

cleanup_token() {
  rm -f /tmp/id-token /tmp/id-token-response /tmp/access-token
}
trap cleanup_token EXIT

token_seconds_left() {
  python3 - <<'PY'
import base64, json, time
raw = open("/tmp/id-token", encoding="utf-8").read().strip().split(".")
if len(raw) != 3:
    raise SystemExit(1)
payload = raw[1] + "=" * ((4 - len(raw[1]) % 4) % 4)
claims = json.loads(base64.urlsafe_b64decode(payload))
print(int(claims["exp"]) - int(time.time()))
PY
}

refresh_id_token() {
  local audience
  : "${SERVICE_URL:?}"
  : "${DEPLOY_SA:?}"
  audience="${SERVICE_URL}"
  gcloud auth print-access-token > /tmp/access-token
  curl -sS -o /tmp/id-token-response -X POST \
    -H "Authorization: Bearer $(< /tmp/access-token)" \
    -H "Content-Type: application/json" \
    -d "{\"audience\":\"${audience}\",\"includeEmail\":true}" \
    "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${DEPLOY_SA}:generateIdToken"
  rm -f /tmp/access-token
  python3 - <<'PY'
import json
body = json.load(open("/tmp/id-token-response", encoding="utf-8"))
token = body.get("token")
if not token:
    error = body.get("error") or {}
    code = error.get("code")
    if code == 403:
        raise SystemExit(
            "403 al renovar el ID token: la identidad WIF no tiene "
            "iam.serviceAccounts.getOpenIdToken sobre sports-demo-deploy. "
            "No es un 403 de roles/run.invoker."
        )
    raise SystemExit("no se pudo renovar el ID token")
open("/tmp/id-token", "w", encoding="utf-8").write(token)
PY
  rm -f /tmp/id-token-response
}

ensure_id_token() {
  if [ ! -s /tmp/id-token ]; then
    if [ -z "${ID_TOKEN_FILE:-}" ] || [ ! -s "${ID_TOKEN_FILE}" ]; then
      echo "Falta el ID token emitido por google-github-actions/auth." >&2
      return 1
    fi
    umask 077
    cp "${ID_TOKEN_FILE}" /tmp/id-token
  fi
  local left
  left="$(token_seconds_left)"
  if [ "${left}" -lt 120 ]; then
    refresh_id_token
  fi
}

run_argv() {
  local source_file="$1"
  local destination="${2:-}"
  if [ -n "${destination}" ]; then
    python3 scripts/run_json_argv.py "${source_file}" "${destination}"
  else
    python3 scripts/run_json_argv.py "${source_file}"
  fi
}

describe_service() {
  gcloud run services describe "${SERVICE}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --format=json > /tmp/service-describe.json
  gcloud run revisions list \
    --service="${SERVICE}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --format=json > /tmp/revisions.json
  python3 scripts/canary_rollout.py prepare-service \
    --describe /tmp/service-describe.json \
    --revisions /tmp/revisions.json \
    --out /tmp/service.json
}

collect_metrics() {
  local revision="$1"
  local destination="$2"
  local attempt=1
  local status
  while [ "${attempt}" -le 3 ]; do
    python3 scripts/canary_rollout.py monitor-argv \
      --project "${PROJECT_ID}" \
      --region "${REGION}" \
      --revision "${revision}" \
      --seconds "${OBSERVATION_SECONDS}" > /tmp/monitor-argv.json
    python3 scripts/run_json_argv.py /tmp/monitor-argv.json > /tmp/monitoring-raw.json
    python3 scripts/canary_rollout.py parse-monitoring \
      --raw /tmp/monitoring-raw.json \
      --project "${PROJECT_ID}" \
      --region "${REGION}" \
      --revision "${revision}" \
      --seconds "${OBSERVATION_SECONDS}" > "${destination}"
    status="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8")).get("query_status", ""))' "${destination}")"
    if [ "${status}" = "ok" ] || [ "${status}" = "insufficient" ] || [ "${status}" = "no_traffic" ]; then
      return 0
    fi
    attempt=$((attempt + 1))
    if [ "${attempt}" -le 3 ]; then
      sleep 20
    fi
  done
}

request_tagged() {
  local track="$1"
  local version="$2"
  local path="$3"
  local request_url
  local audience
  local status
  python3 scripts/canary_smoke.py plan \
    --service /tmp/service.json \
    --track "${track}" \
    --path "${path}" > /tmp/smoke-plan.txt
  request_url="$(sed -n 's/^request_url=//p' /tmp/smoke-plan.txt)"
  audience="$(sed -n 's/^audience=//p' /tmp/smoke-plan.txt)"
  if [ "${audience}" != "${SERVICE_URL}" ]; then
    echo "La audiencia del smoke no es la URL principal del servicio." >&2
    return 1
  fi
  ensure_id_token
  status="$(curl -sS -o /tmp/smoke-body -D /tmp/smoke-headers -w '%{http_code}' \
    -H "Authorization: Bearer $(< /tmp/id-token)" \
    "${request_url}")"
  if [ "${status}" = "403" ]; then
    echo "Cloud Run respondió 403 con un ID token ya emitido. Falta roles/run.invoker de ${DEPLOY_SA} sobre ${SERVICE}." >&2
    return 1
  fi
  printf '%s\n' "${status}" > /tmp/http-status
  python3 scripts/canary_smoke.py classify \
    --status "${status}" \
    --track "${track}" \
    --version "${version}" \
    --header-file /tmp/smoke-headers
}

preflight_revision() {
  local revision="$1"
  local track="$2"
  local version="$3"
  local ready_status
  request_tagged "${track}" "${version}" "/health/ready"
  gcloud logging read \
    "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${SERVICE}\" AND resource.labels.revision_name=\"${revision}\"" \
    --project="${PROJECT_ID}" \
    --freshness=1d \
    --limit=100 \
    --format='value(textPayload,jsonPayload.message,jsonPayload.msg)' > /tmp/boot.log
  ready_status="$(< /tmp/http-status)"
  python3 scripts/canary_smoke.py preflight \
    --log /tmp/boot.log \
    --ready-status "${ready_status}"
}

publish_track() {
  local sha="$1"
  local track="$2"
  local image="$3"
  local digest
  if ! [[ "${sha}" =~ ^[0-9a-f]{40}$ ]]; then
    echo "El SHA de ${track} no es un commit completo." >&2
    exit 1
  fi
  git fetch --depth 1 origin "${sha}"
  git checkout --detach "${sha}"
  if [ "$(git rev-parse HEAD)" != "${sha}" ]; then
    echo "El checkout de ${track} no coincide con el SHA pedido." >&2
    exit 1
  fi
  if [ "${track}" = "stable" ] && [ -e src/routes/v4/index.ts ]; then
    echo "Stable no puede construirse desde el código Canary." >&2
    exit 1
  fi
  if [ "${track}" = "canary" ] && [ ! -e src/routes/v4/index.ts ]; then
    echo "Canary no contiene las rutas v4 de su commit." >&2
    exit 1
  fi
  docker build --pull=false -t "${image}:${sha}" .
  docker push "${image}:${sha}"
  digest="$(docker inspect --format='{{index .RepoDigests 0}}' "${image}:${sha}")"
  printf '%s\n' "${digest}"
}

deploy_track() {
  local track="$1"
  local digest="$2"
  local version="$3"
  local mode="${4:-update}"
  if [ "${mode}" = "initial" ]; then
    python3 scripts/canary_rollout.py deploy-argv \
      --track "${track}" \
      --digest "${digest}" \
      --project "${PROJECT_ID}" \
      --region "${REGION}" \
      --service-account "${RUNTIME_SA}" \
      --connection-name "${CONNECTION_NAME}" \
      --secret "${DB_SECRET}" \
      --object-storage-url "${OBJECT_STORAGE_API_URL:-}" \
      --initial > /tmp/deploy.json || return 1
  else
    python3 scripts/canary_rollout.py deploy-argv \
      --track "${track}" \
      --digest "${digest}" \
      --project "${PROJECT_ID}" \
      --region "${REGION}" \
      --service-account "${RUNTIME_SA}" \
      --connection-name "${CONNECTION_NAME}" \
      --secret "${DB_SECRET}" \
      --object-storage-url "${OBJECT_STORAGE_API_URL:-}" > /tmp/deploy.json || return 1
  fi
  run_argv /tmp/deploy.json /tmp/deploy-response.json || return 1
  python3 scripts/canary_rollout.py created-revision \
    --file /tmp/deploy-response.json > /tmp/created-revision.txt || return 1
  local revision
  revision="$(cat /tmp/created-revision.txt)"
  wait_revision_ready "${revision}" "${digest}" "${track}" || return 1
  describe_service || return 1
  preflight_revision "${revision}" "${track}" "${version}" || return 1
  printf '%s\n' "${revision}"
}

wait_revision_ready() {
  local revision="$1"
  local digest="$2"
  local track="$3"
  local attempt=1
  local state
  while [ "${attempt}" -le 6 ]; do
    gcloud run revisions describe "${revision}" \
      --project="${PROJECT_ID}" \
      --region="${REGION}" \
      --format=json > /tmp/revision.json
    set +e
    python3 scripts/canary_rollout.py revision-wait \
      --file /tmp/revision.json \
      --digest "${digest}" \
      --track "${track}" > /tmp/revision-wait.txt
    state="$?"
    set -e
    if [ "${state}" -eq 0 ]; then
      return 0
    fi
    if [ "${state}" -ne 2 ]; then
      echo "La revisión ${revision} falló o no usa el digest esperado." >&2
      return 1
    fi
    if [ "${attempt}" -eq 6 ]; then
      echo "La revisión ${revision} no llegó a Ready en los reintentos." >&2
      return 1
    fi
    sleep 10
    attempt=$((attempt + 1))
  done
}

case "${OPERATION}" in
  publish)
    : "${STABLE_SHA:?}"
    : "${CANARY_SHA:?}"
    : "${AR_REPOSITORY:?}"
    if [ "${STABLE_SHA}" = "${CANARY_SHA}" ]; then
      echo "Stable y Canary deben salir de commits distintos." >&2
      exit 1
    fi
    stable_image="us-central1-docker.pkg.dev/${PROJECT_ID}/${AR_REPOSITORY}/sports-api-v3"
    canary_image="us-central1-docker.pkg.dev/${PROJECT_ID}/${AR_REPOSITORY}/sports-api-v4"
    publish_track "${STABLE_SHA}" stable "${stable_image}" > /tmp/stable-digest.txt
    publish_track "${CANARY_SHA}" canary "${canary_image}" > /tmp/canary-digest.txt
    python3 scripts/canary_rollout.py images \
      --stable "$(cat /tmp/stable-digest.txt)" \
      --canary "$(cat /tmp/canary-digest.txt)"
    ;;
  deploy-stable)
    : "${STABLE_DIGEST:?}"
    mode="update"
    if ! gcloud run services describe "${SERVICE}" \
      --project="${PROJECT_ID}" \
      --region="${REGION}" \
      --format='value(metadata.name)' >/dev/null 2>&1; then
      echo "Creación inicial: Stable recibe el 100%."
      mode="initial"
    else
      echo "El servicio ya existe. Stable se despliega sin tráfico y el reparto no cambia."
    fi
    revision="$(deploy_track stable "${STABLE_DIGEST}" "3.0.2" "${mode}")" || exit 1
    if [ "${mode}" = "initial" ]; then
      python3 scripts/canary_rollout.py pin-argv \
        --project "${PROJECT_ID}" \
        --region "${REGION}" \
        --revision "${revision}" > /tmp/pin.json
      run_argv /tmp/pin.json
      describe_service
      python3 scripts/canary_rollout.py assert-pin \
        --service /tmp/service.json \
        --revision "${revision}"
    fi
    ;;
  deploy-canary)
    : "${STABLE_DIGEST:?}"
    : "${CANARY_DIGEST:?}"
    python3 scripts/canary_rollout.py images \
      --stable "${STABLE_DIGEST}" \
      --canary "${CANARY_DIGEST}"
    revision="$(deploy_track canary "${CANARY_DIGEST}" "4.0.0")" || exit 1
    describe_service
    request_tagged canary "4.0.0" "/api/v2/torneos"
    request_tagged canary "4.0.0" "/api/v4/torneos/estadisticas"
    python3 scripts/canary_rollout.py current-canary \
      --service /tmp/service.json \
      --canary-revision "${revision}" > /tmp/current-canary.txt
    if [ "$(< /tmp/current-canary.txt)" != "0" ]; then
      echo "Canary recibió tráfico antes de la promoción." >&2
      exit 1
    fi
    ;;
  promote)
    : "${STABLE_REVISION:?}"
    : "${CANARY_REVISION:?}"
    : "${CANARY_PERCENT:?}"
    : "${STABLE_PERCENT:?}"
    : "${OBSERVATION_SECONDS:?}"
    describe_service
    python3 scripts/canary_rollout.py current-canary \
      --service /tmp/service.json \
      --canary-revision "${CANARY_REVISION}" > /tmp/current-canary.txt
    current="$(< /tmp/current-canary.txt)"
    preflight_revision "${CANARY_REVISION}" canary "4.0.0" > /tmp/preflight.txt
    connector_status="$(sed -n 's/^status=//p' /tmp/preflight.txt)"
    if [ "${current}" = "0" ]; then
      request_tagged canary "4.0.0" "/api/v2/torneos"
      request_tagged canary "4.0.0" "/api/v4/torneos/estadisticas"
      python3 scripts/canary_rollout.py promote-decision \
        --current-canary 0 \
        --target-canary "${CANARY_PERCENT}" \
        --connector-preflight "${connector_status}" \
        --smoke-ok
    else
      collect_metrics "${CANARY_REVISION}" /tmp/canary-metrics.json
      collect_metrics "${STABLE_REVISION}" /tmp/stable-metrics.json
      set +e
      python3 scripts/canary_rollout.py promote-decision \
        --current-canary "${current}" \
        --target-canary "${CANARY_PERCENT}" \
        --connector-preflight "${connector_status}" \
        --smoke-ok \
        --canary-metrics /tmp/canary-metrics.json \
        --stable-metrics /tmp/stable-metrics.json \
        --observation-seconds "${OBSERVATION_SECONDS}" \
        --waited-seconds "${WAITED_SECONDS:-0}"
      gate_status="$?"
      set -e
      if [ "${gate_status}" -eq 3 ] && [ "${current}" -gt 0 ]; then
        python3 scripts/canary_rollout.py rollback-plan \
          --stable-revision "${STABLE_REVISION}" \
          --canary-revision "${CANARY_REVISION}" \
          --reason "rollback por regresión o falta de observabilidad" > /tmp/rollback.json
        python3 scripts/canary_rollout.py traffic-argv \
          --project "${PROJECT_ID}" \
          --region "${REGION}" \
          --stable-revision "${STABLE_REVISION}" \
          --canary-revision "${CANARY_REVISION}" \
          --stable-percent 100 \
          --canary-percent 0 > /tmp/traffic-argv.json
        run_argv /tmp/traffic-argv.json
        describe_service
        python3 scripts/canary_rollout.py assert-split \
          --service /tmp/service.json \
          --stable-revision "${STABLE_REVISION}" \
          --canary-revision "${CANARY_REVISION}" \
          --stable-percent 100 \
          --canary-percent 0
        exit 3
      fi
      if [ "${gate_status}" -ne 0 ]; then
        exit "${gate_status}"
      fi
    fi
    python3 scripts/canary_rollout.py traffic-argv \
      --project "${PROJECT_ID}" \
      --region "${REGION}" \
      --stable-revision "${STABLE_REVISION}" \
      --canary-revision "${CANARY_REVISION}" \
      --stable-percent "${STABLE_PERCENT}" \
      --canary-percent "${CANARY_PERCENT}" > /tmp/traffic-argv.json
    run_argv /tmp/traffic-argv.json
    describe_service
    python3 scripts/canary_rollout.py assert-split \
      --service /tmp/service.json \
      --stable-revision "${STABLE_REVISION}" \
      --canary-revision "${CANARY_REVISION}" \
      --stable-percent "${STABLE_PERCENT}" \
      --canary-percent "${CANARY_PERCENT}"
    ;;
  verify)
    : "${STABLE_REVISION:?}"
    : "${CANARY_REVISION:?}"
    describe_service
    python3 scripts/canary_rollout.py assert-split \
      --service /tmp/service.json \
      --stable-revision "${STABLE_REVISION}" \
      --canary-revision "${CANARY_REVISION}" \
      --stable-percent 100 \
      --canary-percent 0
    gcloud run services get-iam-policy "${SERVICE}" \
      --project="${PROJECT_ID}" \
      --region="${REGION}" \
      --format=json > /tmp/run-iam.json
    python3 - <<'PY'
import json
policy = json.load(open("/tmp/run-iam.json", encoding="utf-8"))
for binding in policy.get("bindings") or []:
    members = binding.get("members") or []
    if "allUsers" in members or "allAuthenticatedUsers" in members:
        raise SystemExit("el servicio no es privado")
print("private=true")
PY
    request_tagged stable "3.0.2" "/health/live"
    request_tagged stable "3.0.2" "/health/ready"
    request_tagged stable "3.0.2" "/api/v2/torneos"
    preflight_revision "${STABLE_REVISION}" stable "3.0.2"
    request_tagged canary "4.0.0" "/health/ready"
    request_tagged canary "4.0.0" "/api/v2/torneos"
    request_tagged canary "4.0.0" "/api/v4/torneos/estadisticas"
    preflight_revision "${CANARY_REVISION}" canary "4.0.0"
    ;;
  rollback)
    : "${STABLE_REVISION:?}"
    : "${CANARY_REVISION:?}"
    describe_service
    python3 scripts/canary_rollout.py traffic-argv \
      --project "${PROJECT_ID}" \
      --region "${REGION}" \
      --stable-revision "${STABLE_REVISION}" \
      --canary-revision "${CANARY_REVISION}" \
      --stable-percent 100 \
      --canary-percent 0 > /tmp/traffic-argv.json
    run_argv /tmp/traffic-argv.json
    describe_service
    python3 scripts/canary_rollout.py assert-split \
      --service /tmp/service.json \
      --stable-revision "${STABLE_REVISION}" \
      --canary-revision "${CANARY_REVISION}" \
      --stable-percent 100 \
      --canary-percent 0
    ;;
  *)
    echo "Operación no desplegable." >&2
    exit 1
    ;;
esac
