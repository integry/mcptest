---
title: "Build a remote MCP server with FastAPI and the Python SDK"
navTitle: Remote server with FastAPI
summary: A complete, tested FastAPI app that mounts the Python SDK's MCPServer with stateless Streamable HTTP, Host and Origin checks, CORS, and a JWT token verifier for a hosted identity provider, plus what mcptest reported for it.
track: build
level: practitioner
order: 32
category: Frameworks
readingTimeMinutes: 5
lastReviewed: "2026-10-21"
metaTitle: Remote MCP Server with FastAPI (Python SDK) | mcptest.io
metaDescription: Build a remote MCP server with FastAPI and the MCP Python SDK. Mount MCPServer, run its session manager in the lifespan, add CORS, verify OAuth tokens with TokenVerifier and AuthSettings.
relatedSlugs:
  - remote-mcp-server-with-express
  - mcp-server-authentication-patterns
  - mcp-cors-headers-for-browser-clients
  - convert-local-stdio-mcp-server-to-remote
  - test-mcp-server-before-deploying
sourceLinks:
  - title: "Python SDK v2: add to an existing app (ASGI)"
    url: "https://py.sdk.modelcontextprotocol.io/run/asgi/"
  - title: "Python SDK v2: authorization"
    url: "https://py.sdk.modelcontextprotocol.io/run/authorization/"
  - title: "FastAPI: sub applications and mounts"
    url: "https://fastapi.tiangolo.com/advanced/sub-applications/"
  - title: "FastAPI: CORS"
    url: "https://fastapi.tiangolo.com/tutorial/cors/"
  - title: MCP 2026-07-28 authorization
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization"
---

The Python SDK's `MCPServer` produces a Starlette app, so the natural way to put it behind FastAPI is to mount it and let FastAPI own the process: lifespan, CORS, health checks, and any REST routes you already have. This guide builds that app with stateless Streamable HTTP and an OAuth token check for a hosted identity provider. Every sample was run under Uvicorn, and the result mcptest reported for it is at the end.

## What was tested

| Package | Version |
| --- | --- |
| `mcp` | 2.3.0 |
| `fastapi` | 0.156.8 |
| `starlette` | 1.9.0 |
| `uvicorn` | 0.54.0 |
| `PyJWT` with the `crypto` extra | 2.15.1 |

The interpreter was CPython 3.11. The identity provider was a local test server publishing a JWKS and signing RS256 tokens.

```bash
pip install "mcp>=2.3,<2.4" fastapi uvicorn "pyjwt[crypto]"
```

## The complete app

```python
# main.py
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import jwt
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import Field

from mcp.server import MCPServer
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.provider import AccessToken
from mcp.server.auth.settings import AuthSettings
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations

PUBLIC_URL = os.environ.get("PUBLIC_URL", "https://mcp.example.com/mcp")
ISSUER = os.environ.get("OAUTH_ISSUER", "https://auth.example.com")
JWKS_URL = os.environ.get("OAUTH_JWKS_URL", "https://auth.example.com/.well-known/jwks.json")
ALLOWED_ORIGINS = ["https://mcptest.io", "https://app.example.com"]


class JWTVerifier:
    """Accept RS256 access tokens from the identity provider, issued for this server."""

    def __init__(self) -> None:
        self._jwks = jwt.PyJWKClient(JWKS_URL, cache_keys=True)

    async def verify_token(self, token: str) -> AccessToken | None:
        try:
            key = self._jwks.get_signing_key_from_jwt(token)
            claims = jwt.decode(token, key, algorithms=["RS256"], issuer=ISSUER, audience=PUBLIC_URL)
        except jwt.PyJWTError:
            return None
        return AccessToken(
            token=token,
            client_id=str(claims.get("client_id") or claims.get("azp") or claims["sub"]),
            scopes=str(claims.get("scope", "")).split(),
            expires_at=claims["exp"],
            resource=PUBLIC_URL,
            subject=claims.get("sub"),
        )


mcp = MCPServer(
    "orders",
    version="1.0.0",
    token_verifier=JWTVerifier(),
    auth=AuthSettings(
        issuer_url=ISSUER,
        resource_server_url=PUBLIC_URL,
        required_scopes=["orders:read"],
        validate_token_resource=True,
    ),
)


@mcp.tool(name="get-order", annotations=ToolAnnotations(read_only_hint=True))
def get_order(id: str = Field(pattern=r"^ord_[a-z0-9]{1,32}$", description="Order id, for example ord_123")) -> str:
    """Look up one order by its id and return its shipping status."""
    token = get_access_token()
    return f"Order {id} for {token.client_id if token else 'anonymous'}: shipped"


public_host = PUBLIC_URL.split("/")[2]
mcp_app = mcp.streamable_http_app(
    stateless_http=True,
    transport_security=TransportSecuritySettings(
        allowed_hosts=[public_host, f"{public_host}:*"],
        allowed_origins=ALLOWED_ORIGINS,
    ),
)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    async with mcp.session_manager.run():
        yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=[
        "Accept", "Authorization", "Content-Type",
        "MCP-Protocol-Version", "Mcp-Method", "Mcp-Name",
        "Mcp-Session-Id", "Last-Event-ID",
    ],
    expose_headers=["Mcp-Session-Id", "MCP-Protocol-Version", "WWW-Authenticate", "Retry-After"],
    max_age=7200,
)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


app.mount("/", mcp_app)
```

Run it with `uvicorn main:app --host 0.0.0.0 --port 8000`.

## How the pieces fit

**The mount and the lifespan.** `streamable_http_app()` returns a Starlette app whose MCP route is `/mcp`, so mounting it at `/` serves `https://mcp.example.com/mcp`. A mounted app's own lifespan never runs, which is why FastAPI's lifespan enters `mcp.session_manager.run()`. Without it, the first request fails with "Task group is not initialized". Register FastAPI routes such as `/healthz` before the mount; the mount at `/` matches everything after it.

**Stateless mode.** `stateless_http=True` stops the server from issuing `Mcp-Session-Id` to 2025 clients, so any replica can answer any request and you do not need sticky sessions. 2026-07-28 clients are stateless either way. With sessions on, which is the default, `Mcp-Session-Id` must stay in `expose_headers` for browser clients.

**Host and Origin.** `TransportSecuritySettings` takes full origins with a scheme, unlike the TypeScript adapters, and host entries with an optional `:*` port wildcard. A `POST` with `Origin: https://evil.example` returned `403`.

**The auth hook.** `MCPServer` takes a `token_verifier` and `AuthSettings`, and wraps the MCP route in its bearer middleware:

| Request | Response from this app |
| --- | --- |
| No token, a bad signature, or `aud` for another server | `401` with `WWW-Authenticate: Bearer error="invalid_token", error_description="Authentication required", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"` |
| Valid token without `orders:read` | `403` with `error="insufficient_scope", error_description="Required scope: orders:read"` |
| Valid token | The tool runs; `get_access_token()` returns the `AccessToken` |

`AuthSettings` also publishes the Protected Resource Metadata document at `/.well-known/oauth-protected-resource/mcp`, built from `resource_server_url`, `issuer_url`, and `required_scopes`:

```json
{"resource":"https://mcp.example.com/mcp","authorization_servers":["https://auth.example.com"],"scopes_supported":["orders:read"],"bearer_methods_supported":["header"]}
```

Set `validate_token_resource=True`. Left unset while `resource_server_url` is set, the SDK emits an `MCPDeprecationWarning` and does not compare `AccessToken.resource` with your URL; version 3.0 will make `True` the default. The verifier above also passes `audience=PUBLIC_URL` to `jwt.decode`, so a token for another server is rejected in either case. The 2026-07-28 specification requires that audience check.

**The verifier is ordinary code.** `verify_token` returns an `AccessToken` or `None`. `PyJWKClient` caches signing keys, but its first fetch is a blocking HTTP call inside an async function. If your identity provider is slow, prefetch the keys at startup or use token introspection with an async HTTP client instead.

**The tool.** `Field(pattern=..., description=...)` puts the constraint and a description into the generated `inputSchema`, and Pydantic rejects `{"id": "bad"}` before your function runs. `name="get-order"` sets the wire name; without it, the function name `get_order` is used.

## Check it before you deploy

With a valid token, a 2026 `server/discover` returned `supportedVersions: ["2026-07-28"]` and capabilities for `tools`, `resources`, and `prompts`. A 2025 `initialize` returned `protocolVersion: "2025-11-25"` with no `Mcp-Session-Id`. The preflight returned `200` from Starlette's middleware with every requested header allowed. Unlike the TypeScript handler, a stateless Python server answers `GET /mcp` with `200` and an open `text/event-stream`, so a 2025 client's optional stream succeeds instead of getting `405`.

## What mcptest reported for this server

Through a local TLS proxy, with a token minted for that URL, the headless gate returned:

| Section | Score | Why |
| --- | ---: | --- |
| Core Protocol Adherence | 15 / 15 | Stateless `server/discover` lifecycle at `2026-07-28` |
| MCP Capabilities | 10 / 10 | `tools/list`, `resources/list`, and `prompts/list` all answered; the SDK advertises all three even when two are empty |
| Transport Layer Modernity | 15 / 15 | Streamable HTTP |
| Security Posture | 40 / 40 | Protected resource metadata, authorization-server metadata, token endpoint, PKCE `S256` |
| Performance Baseline | 15 / 15 | Negotiation under 500 ms |

That is 95 out of 95, but the decision was **review**. The tool-surface analysis kept one medium finding, `tool.schema.unconstrained-inputs`, because the Python SDK's generated schema does not set `additionalProperties: false` and the decorator has no option for it. If you need a fully closed schema, the [low-level server](https://py.sdk.modelcontextprotocol.io/advanced/low-level-server/) lets you declare `inputSchema` yourself. The other entries were unknown host-compatibility observations such as token refresh.

## FastAPI mistakes that look like protocol bugs

- **Mounting at `/mcp`.** `app.mount("/mcp", mcp_app)` serves the endpoint at `/mcp/mcp`, while clients are given `/mcp`. Mount at `/` and keep the SDK's default path.
- **`resource_server_url` set to an internal URL.** Behind a load balancer, `http://10.0.0.5:8000/mcp` in the metadata makes every client fail audience validation. Use the public URL.
- **Several Uvicorn workers with sessions on.** Each worker keeps its own session table. With `stateless_http=False`, a request carrying a session id the worker does not know returned `404` with `"Session not found"`, which is what a 2025 client sees when its second request lands on another worker. Stateless mode avoids it.

## Run the gate on your deployment

Open the deployed URL in the [MCP Playground](/) to complete sign-in in the browser and see the tool-surface findings with their evidence, then add `npm run mcptest -- --bearer-token-env MCPTEST_BEARER_TOKEN https://staging.example.com/mcp` to your pipeline as shown in [How to test an MCP server before you deploy it](/learn/test-mcp-server-before-deploying#run-the-same-checks-in-ci).
