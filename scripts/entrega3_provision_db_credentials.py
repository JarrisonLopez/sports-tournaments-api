#!/usr/bin/env python3
"""Carga la password de app en Secret Manager y crea/actualiza sports_user vía Cloud SQL Admin API.

Usa Application Default Credentials del runner (WIF). No imprime la contraseña
ni el cuerpo JSON de las peticiones. No escribe llaves JSON.
"""

from __future__ import annotations

import base64
import json
import os
import sys
import time
import urllib.parse

from google.auth import default
from google.auth.transport.requests import AuthorizedSession


def fail(message: str, code: int = 1) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(code)


def require_env(name: str) -> str:
    value = os.environ.get(name, "")
    if not value:
        fail(f"Missing required environment variable: {name}")
    return value


def api_request(
    session: AuthorizedSession,
    method: str,
    url: str,
    body: dict | None = None,
) -> tuple[int, dict]:
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    response = session.request(method, url, data=data, headers=headers, timeout=120)
    raw = response.content or b""
    payload: dict = {}
    if raw:
        try:
            parsed = json.loads(raw.decode("utf-8"))
            if isinstance(parsed, dict):
                payload = parsed
        except json.JSONDecodeError:
            payload = {}

    if response.status_code >= 400:
        # No volcar body: puede incluir campos sensibles en algunos errores.
        status = payload.get("error", {}).get("status") if payload else None
        code = payload.get("error", {}).get("code") if payload else response.status_code
        fail(f"API {method} failed: HTTP {response.status_code} code={code} status={status}")

    return response.status_code, payload


def wait_sql_operation(session: AuthorizedSession, project: str, operation: dict) -> None:
    op_name = operation.get("name")
    if not op_name:
        fail("Cloud SQL operation response missing name")

    url = f"https://sqladmin.googleapis.com/v1/projects/{project}/operations/{op_name}"
    for _ in range(60):
        _, payload = api_request(session, "GET", url)
        status = payload.get("status")
        if status == "DONE":
            if payload.get("error"):
                fail(f"Cloud SQL operation {op_name} finished with error")
            return
        time.sleep(5)

    fail(f"Timed out waiting for Cloud SQL operation {op_name}")


def add_secret_version(session: AuthorizedSession, project: str, secret_id: str, password: str) -> None:
    parent = f"projects/{project}/secrets/{secret_id}"
    url = f"https://secretmanager.googleapis.com/v1/{parent}:addVersion"
    body = {
        "payload": {
            "data": base64.b64encode(password.encode("utf-8")).decode("ascii"),
        }
    }
    print(f"Adding Secret Manager version to {secret_id} (value not logged).")
    api_request(session, "POST", url, body)
    print("Secret Manager version added.")


def list_mysql_users(session: AuthorizedSession, project: str, instance: str) -> list[dict]:
    url = (
        f"https://sqladmin.googleapis.com/v1/projects/{project}"
        f"/instances/{instance}/users"
    )
    _, payload = api_request(session, "GET", url)
    items = payload.get("items") or []
    return items if isinstance(items, list) else []


def upsert_mysql_user(
    session: AuthorizedSession,
    project: str,
    instance: str,
    user: str,
    host: str,
    password: str,
) -> None:
    existing = list_mysql_users(session, project, instance)
    found = any(
        item.get("name") == user and (item.get("host") or "%") == host for item in existing
    )

    body = {
        "name": user,
        "host": host,
        "password": password,
    }

    if found:
        print(f"Updating Cloud SQL user {user}@{host} via Admin API (password not logged).")
        query = urllib.parse.urlencode({"name": user, "host": host})
        url = (
            f"https://sqladmin.googleapis.com/v1/projects/{project}"
            f"/instances/{instance}/users?{query}"
        )
        _, operation = api_request(session, "PUT", url, body)
    else:
        print(f"Creating Cloud SQL user {user}@{host} via Admin API (password not logged).")
        url = (
            f"https://sqladmin.googleapis.com/v1/projects/{project}"
            f"/instances/{instance}/users"
        )
        _, operation = api_request(session, "POST", url, body)

    wait_sql_operation(session, project, operation)
    print(f"Cloud SQL user {user} is ready (credentials not logged).")


def main() -> None:
    project = require_env("PROJECT_ID")
    instance = require_env("SQL_INSTANCE")
    secret_id = require_env("SECRET_ID")
    db_user = require_env("DB_USER")
    password = require_env("SPORTS_DB_PASSWORD")
    host = os.environ.get("DB_USER_HOST", "%")

    credentials, _ = default(
        scopes=[
            "https://www.googleapis.com/auth/cloud-platform",
        ]
    )
    session = AuthorizedSession(credentials)

    add_secret_version(session, project, secret_id, password)
    upsert_mysql_user(session, project, instance, db_user, host, password)


if __name__ == "__main__":
    main()
