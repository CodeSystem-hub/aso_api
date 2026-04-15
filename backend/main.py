from __future__ import annotations

import base64
import logging
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional
from urllib.parse import unquote

import httpx
from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

ROOT_DIR = Path(__file__).resolve().parents[1]
HISTORY_DIR = ROOT_DIR / "historico"
logger = logging.getLogger("aso_api.proxy")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(240.0, connect=30.0),
        follow_redirects=False,
        limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
    )
    try:
        yield
    finally:
        await app.state.http_client.aclose()


app = FastAPI(lifespan=lifespan)


def _is_allowed_target(target_url: str) -> bool:
    try:
        u = httpx.URL(target_url)
        if u.scheme != "https":
            return False
        host = (u.host or "").lower()
        return host.endswith(".rm.cloudtotvs.com.br")
    except Exception:
        return False


def _sanitize_filename(name: str) -> str:
    name = name.strip()
    name = re.sub(r"[^a-zA-Z0-9._-]+", "_", name)
    if not name.lower().endswith(".xlsx"):
        name = f"{name}.xlsx"
    return name[:180] if len(name) > 180 else name


async def _request_upstream(
    request: Request,
    method: str,
    target: str,
    headers: dict[str, str],
    body: bytes | None,
) -> httpx.Response:
    client: httpx.AsyncClient = request.app.state.http_client
    attempts = 3 if method == "GET" else 2
    last_error: httpx.RequestError | None = None
    redirect_codes = {301, 302, 303, 307, 308}

    for attempt in range(1, attempts + 1):
        try:
            current_target = target
            current_method = method
            current_body = body
            retry_due_to_status = False
            response: httpx.Response | None = None

            for _ in range(3):
                response = await client.request(current_method, current_target, headers=headers, content=current_body)

                location = response.headers.get("location")
                if response.status_code in redirect_codes and location:
                    try:
                        next_url = httpx.URL(location)
                        if not next_url.is_absolute_url:
                            next_url = httpx.URL(current_target).join(location)
                    except Exception:
                        break

                    next_target = str(next_url)
                    if not _is_allowed_target(next_target):
                        raise HTTPException(status_code=502, detail="Upstream redirect blocked")

                    current_target = next_target
                    if response.status_code == 303:
                        current_method = "GET"
                        current_body = None
                    continue

                if current_method == "GET" and response.status_code in {408, 429, 500, 502, 503, 504} and attempt < attempts:
                    retry_due_to_status = True
                break

            if retry_due_to_status:
                continue

            return response if response is not None else await client.request(current_method, current_target, headers=headers, content=current_body)
        except httpx.RequestError as exc:
            last_error = exc
            can_retry_write = isinstance(exc, (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout))
            if method != "GET" and not can_retry_write:
                break
            if attempt >= attempts:
                break

    raise HTTPException(status_code=502, detail=f"Upstream fetch failed: {last_error}") from last_error


@app.middleware("http")
async def cors_middleware(request: Request, call_next):
    origin = request.headers.get("origin") or "*"
    if request.method == "OPTIONS":
        return Response(
            status_code=204,
            headers={
                "Access-Control-Allow-Origin": origin,
                "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "Authorization, Accept, Content-Type, X-HTTP-Method-Override, X-Proxy-Upstream-Method, CODCOLIGADA, CODPESSOA",
                "Access-Control-Expose-Headers": "X-Proxy-Upstream-Method",
                "Access-Control-Max-Age": "86400",
            },
        )
    response: Response = await call_next(request)
    response.headers["Access-Control-Allow-Origin"] = origin
    response.headers["Access-Control-Expose-Headers"] = "X-Proxy-Upstream-Method"
    return response


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/history/list")
async def history_list():
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    files = []
    for p in HISTORY_DIR.glob("*.xlsx"):
        st = p.stat()
        files.append({"fileName": p.name, "mtimeMs": int(st.st_mtime * 1000), "size": st.st_size})
    files.sort(key=lambda x: x["mtimeMs"], reverse=True)
    return {"ok": True, "files": files}


@app.post("/save")
async def save_file(payload: dict[str, Any] = Body(...)):
    raw_name = str(payload.get("fileName") or "")
    b64 = str(payload.get("base64") or "")
    if not raw_name:
        raise HTTPException(status_code=400, detail="Missing fileName")
    if not b64:
        raise HTTPException(status_code=400, detail="Missing base64")
    name = _sanitize_filename(raw_name)
    try:
        data = base64.b64decode(b64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64")
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    path = HISTORY_DIR / name
    path.write_bytes(data)
    return {"ok": True, "fileName": name, "filePath": str(path)}


@app.api_route("/proxy", methods=["GET", "POST", "DELETE"])
async def proxy(request: Request, target: Optional[str] = None):
    if not target:
        raise HTTPException(status_code=400, detail="Missing target query param")

    target = unquote(target)
    if not _is_allowed_target(target):
        raise HTTPException(status_code=400, detail="Target not allowed")

    method = request.method.upper()
    requested_upstream_method = (request.headers.get("x-proxy-upstream-method") or "").upper()
    upstream_method = requested_upstream_method if requested_upstream_method in {"GET", "POST", "DELETE"} else method
    headers: dict[str, str] = {}
    accept = request.headers.get("accept")
    if accept:
        headers["accept"] = accept
    auth = request.headers.get("authorization")
    if auth:
        headers["authorization"] = auth
    content_type = request.headers.get("content-type")
    if content_type:
        headers["content-type"] = content_type
    method_override = request.headers.get("x-http-method-override")
    if method_override:
        headers["x-http-method-override"] = method_override
    cod_coligada = request.headers.get("codcoligada")
    if cod_coligada:
        headers["codcoligada"] = cod_coligada
    cod_pessoa = request.headers.get("codpessoa")
    if cod_pessoa:
        headers["codpessoa"] = cod_pessoa

    body = await request.body() if upstream_method == "POST" else None

    try:
        r = await _request_upstream(request, upstream_method, target, headers, body)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Proxy internal failure for %s %s", upstream_method, target)
        raise HTTPException(status_code=502, detail=f"Proxy internal failure: {exc.__class__.__name__}") from exc

    content = r.content
    resp_headers = {
        "Content-Type": r.headers.get("content-type", "application/octet-stream"),
        "X-Proxy-Upstream-Method": upstream_method,
    }
    return Response(content=content, status_code=r.status_code, headers=resp_headers)


app.mount("/", StaticFiles(directory=str(ROOT_DIR), html=True), name="static")
