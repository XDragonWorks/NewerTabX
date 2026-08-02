import asyncio
import base64
import hashlib
import io
import json
import logging
import math
import mimetypes
import os
import re
import secrets
import subprocess
import sys
import tempfile
import threading
import urllib.request
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional
from urllib.parse import urljoin, urlsplit

import httpx
import yaml
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.wsgi import WSGIMiddleware
from wsgidav.wsgidav_app import WsgiDAVApp


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("backend")

APP_DIR = Path(__file__).resolve().parent


def _is_packaged() -> bool:
    return getattr(sys, "frozen", False)


def _executable_path() -> Path:
    return Path(sys.executable)


def _default_data_root() -> Path:
    """数据目录双模：

    - 开发模式：源码目录下的 data/
    - 便携模式：exe 旁存在 data/ 目录或 portable.txt 标记 → 跟随 exe（便携版发行形态）
    - 安装模式：平台标准数据目录（安装版发行形态）
    DATA_ROOT 环境变量始终优先（调用方处理）。
    """
    if not _is_packaged():
        return APP_DIR / "data"

    exe_dir = _executable_path().parent
    if (exe_dir / "data").is_dir() or (exe_dir / "portable.txt").exists():
        return exe_dir / "data"

    if os.name == "nt":
        base = os.environ.get("APPDATA")
        return (Path(base) if base else Path.home() / "AppData" / "Roaming") / "NewerTabX"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "NewerTabX"
    xdg_data_home = os.environ.get("XDG_DATA_HOME")
    return (Path(xdg_data_home) if xdg_data_home else Path.home() / ".local" / "share") / "newertabx"


DATA_ROOT = Path(os.environ.get("DATA_ROOT", str(_default_data_root()))).expanduser().resolve()


def _load_app_meta() -> Dict[str, str]:
    meta = {
        "version": "0.0.0-dev",
        "repo": "",
    }
    meta_path = APP_DIR / "app-meta.json"
    if meta_path.is_file():
        try:
            loaded = json.loads(meta_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                for key in ("version", "repo"):
                    if isinstance(loaded.get(key), str) and loaded[key]:
                        meta[key] = loaded[key]
        except (OSError, json.JSONDecodeError) as error:
            logger.warning("Failed to read app-meta.json: %s", error)
    if os.environ.get("APP_VERSION"):
        meta["version"] = os.environ["APP_VERSION"]
    if os.environ.get("GITHUB_REPO"):
        meta["repo"] = os.environ["GITHUB_REPO"]
    return meta


APP_META = _load_app_meta()
APP_VERSION = APP_META["version"]
# 形如 "owner/NewerTabX"，用于 GitHub Releases 更新检查
GITHUB_REPO = APP_META["repo"]
CARDS_ROOT = (DATA_ROOT / "cards").resolve()
CACHE_ROOT = (DATA_ROOT / "cache").resolve()
CACHE_META_ROOT = (DATA_ROOT / ".cache_meta").resolve()
STORAGE_ROOT = (DATA_ROOT / "storage").resolve()
FRONTEND_DIST = Path(
    os.environ.get("FRONTEND_DIST", APP_DIR / "public")
).expanduser().resolve()

for directory in (DATA_ROOT, CARDS_ROOT, CACHE_ROOT, CACHE_META_ROOT, STORAGE_ROOT):
    directory.mkdir(parents=True, exist_ok=True)

MAX_CARD_BYTES = int(os.environ.get("MAX_CARD_BYTES", str(2 * 1024 * 1024)))
MAX_CACHE_BYTES = int(os.environ.get("MAX_CACHE_BYTES", str(64 * 1024 * 1024)))
MAX_CONFIG_BYTES = int(os.environ.get("MAX_CONFIG_BYTES", str(2 * 1024 * 1024)))
# 缓存过期后的宽限期：期间仍提供旧内容（stale-while-revalidate），超出才清理
STALE_CACHE_GRACE_MS = float(os.environ.get("STALE_CACHE_GRACE_HOURS", "72")) * 3600.0 * 1000.0
CARD_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
ENV_KEY_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]{0,127}$")


def _split_env_list(name: str, defaults: List[str]) -> List[str]:
    raw = os.environ.get(name)
    if raw is None:
        return defaults
    return [item.strip() for item in raw.split(",") if item.strip()]


ALLOWED_ORIGINS = _split_env_list(
    "ALLOWED_ORIGINS",
    [
        "http://127.0.0.1:38080",
        "http://localhost:38080",
        "http://127.0.0.1:38081",
        "http://localhost:38081",
    ],
)

app = FastAPI(title="NewerTabX Backend", version=APP_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1024)


# ── 专用 I/O 线程池 ──────────────────────────────────────────
# 与 WSGIMiddleware 的默认线程池隔离，避免图块下载耗光线程后
# WebDAV / config 等请求也跟着排队。
_IO_WORKERS = int(os.environ.get("IO_WORKERS", "16"))
IO_EXECUTOR = ThreadPoolExecutor(max_workers=_IO_WORKERS, thread_name_prefix="io")


async def _run_io(func, *args):
    """在专用 I/O 线程池中执行同步阻塞代码，不污染默认线程池。"""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(IO_EXECUTOR, func, *args)


# ── 出站代理并发信号量 ──────────────────────────────────────
# 限制同时向外部发起的代理/下载请求数，防止打满 httpx 连接池。
_PROXY_LIMIT = int(os.environ.get("PROXY_CONCURRENCY_LIMIT", "50"))
_proxy_semaphore = asyncio.Semaphore(_PROXY_LIMIT)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _atomic_write_yaml(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Optional[Path] = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary_file:
            yaml.safe_dump(data, temporary_file, allow_unicode=True, sort_keys=False)
            temporary_path = Path(temporary_file.name)
        os.replace(temporary_path, path)
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink(missing_ok=True)


def _read_yaml_dict(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as file:
        content = yaml.safe_load(file)
    if content is None:
        return {}
    if not isinstance(content, dict):
        raise ValueError(f"{path.name} must contain a YAML mapping")
    return content


def _safe_child_path(root: Path, key: str) -> Path:
    if not key or "\x00" in key:
        raise HTTPException(status_code=400, detail="Storage key must not be empty")

    normalized = key.replace("\\", "/")
    if normalized.startswith("/") or re.match(r"^[A-Za-z]:", normalized):
        raise HTTPException(status_code=400, detail="Absolute storage paths are not allowed")

    candidate = (root / normalized).resolve(strict=False)
    try:
        candidate.relative_to(root.resolve())
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Storage path escapes its data root") from error
    return candidate


def _validate_card_id(card_id: str) -> str:
    if CARD_ID_PATTERN.fullmatch(card_id) is None:
        raise HTTPException(
            status_code=400,
            detail="Card id must use 1-128 ASCII letters, numbers, dots, underscores, or hyphens",
        )
    return card_id


def _validate_environment_key(key: str) -> str:
    if ENV_KEY_PATTERN.fullmatch(key) is None:
        raise HTTPException(
            status_code=400,
            detail="Environment key must use uppercase ASCII letters, numbers, and underscores",
        )
    return key


async def _read_limited_body(request: Request, maximum_bytes: int) -> bytes:
    body = await request.body()
    if len(body) > maximum_bytes:
        raise HTTPException(status_code=413, detail=f"Request body exceeds {maximum_bytes} bytes")
    return body


DEFAULT_BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    "Accept": "*/*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
}
PROXY_BLOCKED_REQUEST_HEADERS = {
    "host",
    "cookie",
    "connection",
    "content-length",
    "transfer-encoding",
    "x-forwarded-for",
    "proxy-authorization",
}
# Cards may forward a session cookie through an explicit opt-in header; the
# backend maps it to the outgoing "Cookie" header so the plain "cookie" header
# stays blocked. The marker header is never forwarded to the target itself.
PROXY_SESSION_COOKIE_HEADER = "x-proxy-cookie"
PROXY_SESSION_COOKIE_MAX_LENGTH = 4096
PROXY_RESPONSE_HEADERS = {
    "cache-control",
    "content-disposition",
    "content-language",
    "content-type",
    "etag",
    "expires",
    "last-modified",
}
REDIRECT_STATUSES = {301, 302, 303, 307, 308}


class ProxyRequest(BaseModel):
    url: str
    method: str = "GET"
    headers: Optional[Dict[str, str]] = None
    body: Optional[Any] = None
    bodyEncoding: Literal["text", "json", "base64"] = "text"


async def _validate_proxy_target(url: str) -> None:
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"}:
        raise HTTPException(status_code=400, detail="Proxy only supports http and https URLs")
    if parsed.hostname is None:
        raise HTTPException(status_code=400, detail="Proxy target must include a hostname")
    if parsed.username is not None or parsed.password is not None:
        raise HTTPException(status_code=400, detail="Credentials in proxy URLs are not allowed")


# Shared HTTP client so outbound requests reuse keep-alive connections instead
# of paying a TCP+TLS handshake per request (map tiles arrive in bursts).
_http_client: Optional[httpx.AsyncClient] = None


def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=15.0,
            follow_redirects=False,
            limits=httpx.Limits(
                max_connections=200,
                max_keepalive_connections=64,
                keepalive_expiry=30.0,
            ),
        )
    return _http_client


def _decode_proxy_body(req: ProxyRequest) -> tuple[Optional[Any], Optional[bytes]]:
    if req.body is None:
        return None, None
    if req.bodyEncoding == "json":
        return req.body, None
    if req.bodyEncoding == "base64":
        if not isinstance(req.body, str):
            raise HTTPException(status_code=400, detail="Base64 proxy body must be a string")
        try:
            return None, base64.b64decode(req.body, validate=True)
        except ValueError as error:
            raise HTTPException(status_code=400, detail="Proxy body is not valid base64") from error
    if not isinstance(req.body, str):
        raise HTTPException(status_code=400, detail="Text proxy body must be a string")
    return None, req.body.encode("utf-8")


@app.post("/api/proxy")
async def proxy_fetch(req: ProxyRequest):
    async with _proxy_semaphore:
        return await _proxy_fetch_impl(req)


async def _proxy_fetch_impl(req: ProxyRequest):
    method = req.method.upper()
    if not re.fullmatch(r"[A-Z]+", method):
        raise HTTPException(status_code=400, detail="Invalid HTTP method")

    forward_headers = DEFAULT_BROWSER_HEADERS.copy()
    session_cookie: Optional[str] = None
    if req.headers is not None:
        for key, value in req.headers.items():
            lowered = key.lower()
            if lowered == PROXY_SESSION_COOKIE_HEADER:
                if (
                    not value
                    or len(value) > PROXY_SESSION_COOKIE_MAX_LENGTH
                    or "\r" in value
                    or "\n" in value
                ):
                    raise HTTPException(
                        status_code=400,
                        detail="Proxy session cookie header is invalid",
                    )
                session_cookie = value
                continue
            if lowered not in PROXY_BLOCKED_REQUEST_HEADERS:
                forward_headers[key] = value
    if session_cookie is not None:
        forward_headers["Cookie"] = session_cookie

    json_body, content_body = _decode_proxy_body(req)
    current_url = req.url

    try:
        client = _get_http_client()
        for _redirect_count in range(6):
            await _validate_proxy_target(current_url)
            result = await client.request(
                method=method,
                url=current_url,
                headers=forward_headers,
                json=json_body,
                content=content_body,
            )

            location = result.headers.get("location")
            if result.status_code not in REDIRECT_STATUSES or location is None:
                response_headers = {
                    key: value
                    for key, value in result.headers.items()
                    if key.lower() in PROXY_RESPONSE_HEADERS
                }
                return Response(
                    content=result.content,
                    status_code=result.status_code,
                    headers=response_headers,
                )

            current_url = urljoin(current_url, location)
            if result.status_code == 303 or (result.status_code in {301, 302} and method == "POST"):
                method = "GET"
                json_body = None
                content_body = None

        raise HTTPException(status_code=508, detail="Proxy target exceeded the redirect limit")
    except HTTPException:
        raise
    except httpx.HTTPError as error:
        logger.warning("Proxy request failed for %s: %s", current_url, error)
        raise HTTPException(status_code=502, detail="Proxy target request failed") from error


DEFAULT_CONFIG: Dict[str, Any] = {
    "version": "1.1.0",
    "theme": "system",
    "editMode": False,
    "appearance": {
        "accentColor": "#0078d4",
        "useWallpaperAccent": False,
        "radius": 12,
        "cardMinWidth": 280,
        "cardRowHeight": 260,
    },
    "performance": {
        "preset": "high",
        "material": "acrylic",
        "enableBlur": True,
        "enableShimmer": True,
        "enableFlipModal": True,
        "blurRadius": 16,
    },
    "wallpaper": {
        "source": "bing",
        "url": "https://bing.biturl.top/?resolution=1920&format=image&index=0&mkt=zh-CN",
        "blurRadius": 0,
        "maskOpacity": 0.15,
        "ttlHours": 24,
        "timestamp": 0,
    },
    "cards": [],
}


def _require_bounded_string(value: Any, field_name: str, maximum_length: int = 256) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum_length:
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} must be a non-empty string up to {maximum_length} characters",
        )
    return value


def _require_grid_integer(value: Any, field_name: str, minimum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum or value > 1000:
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} must be an integer between {minimum} and 1000",
        )
    return value


def _validate_config_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    theme = data.get("theme", "system")
    if theme not in {"system", "light", "dark"}:
        raise HTTPException(status_code=400, detail="theme must be system, light, or dark")

    cards = data.get("cards", [])
    if not isinstance(cards, list):
        raise HTTPException(status_code=400, detail="cards must be an array")
    if len(cards) > 2000:
        raise HTTPException(status_code=400, detail="cards contains too many entries")

    seen_card_ids = set()
    for index, card in enumerate(cards):
        if not isinstance(card, dict):
            raise HTTPException(status_code=400, detail=f"cards[{index}] must be an object")
        card_id = _validate_card_id(
            _require_bounded_string(card.get("id"), f"cards[{index}].id", 128)
        )
        if card_id in seen_card_ids:
            raise HTTPException(status_code=400, detail=f"Duplicate card id: {card_id}")
        seen_card_ids.add(card_id)
        _validate_card_id(
            _require_bounded_string(card.get("type"), f"cards[{index}].type", 128)
        )
        if "title" in card and (
            not isinstance(card["title"], str) or len(card["title"]) > 256
        ):
            raise HTTPException(
                status_code=400,
                detail=f"cards[{index}].title must be a string up to 256 characters",
            )
        _require_grid_integer(card.get("w"), f"cards[{index}].w", 1)
        _require_grid_integer(card.get("h"), f"cards[{index}].h", 1)
        for optional_field in ("x", "y", "order"):
            if optional_field in card:
                _require_grid_integer(
                    card[optional_field], f"cards[{index}].{optional_field}", 0
                )

    definitions = data.get("cardDefinitions", {})
    if not isinstance(definitions, dict):
        raise HTTPException(status_code=400, detail="cardDefinitions must be an object")
    for definition_key, definition in definitions.items():
        validated_key = _validate_card_id(
            _require_bounded_string(definition_key, "card definition key", 128)
        )
        if not isinstance(definition, dict):
            raise HTTPException(
                status_code=400,
                detail=f"Card definition {validated_key} must be an object",
            )
        definition_id = _validate_card_id(
            _require_bounded_string(
                definition.get("id"), f"cardDefinitions.{validated_key}.id", 128
            )
        )
        if definition_id != validated_key:
            raise HTTPException(
                status_code=400,
                detail=f"Card definition key {validated_key} must match its id",
            )
        _require_bounded_string(
            definition.get("title"), f"cardDefinitions.{validated_key}.title", 256
        )
        permissions = definition.get("permissions")
        if permissions is not None and (
            not isinstance(permissions, list)
            or any(
                not isinstance(permission, str) or len(permission) > 128
                for permission in permissions
            )
        ):
            raise HTTPException(
                status_code=400,
                detail=f"cardDefinitions.{validated_key}.permissions must be a string array",
            )

    for mapping_field in ("appearance", "performance", "wallpaper", "settings"):
        if mapping_field in data and not isinstance(data[mapping_field], dict):
            raise HTTPException(
                status_code=400, detail=f"{mapping_field} must be an object"
            )

    performance = data.get("performance", {})
    if performance:
        if performance.get("preset", "high") not in {"high", "medium", "low", "custom"}:
            raise HTTPException(status_code=400, detail="performance.preset is invalid")
        if performance.get("material", "acrylic") not in {"acrylic", "mica", "opaque"}:
            raise HTTPException(status_code=400, detail="performance.material is invalid")
        blur_radius = performance.get("blurRadius", 0)
        if (
            isinstance(blur_radius, bool)
            or not isinstance(blur_radius, (int, float))
            or not math.isfinite(blur_radius)
            or not 0 <= blur_radius <= 40
        ):
            raise HTTPException(
                status_code=400,
                detail="performance.blurRadius must be between 0 and 40",
            )

    return data


@app.get("/api/config")
@app.get("/api/data/config")
async def get_config():
    config_path = DATA_ROOT / "config.yml"
    if not config_path.exists():
        await _run_io(_atomic_write_yaml, config_path, DEFAULT_CONFIG)
        return DEFAULT_CONFIG
    try:
        return await _run_io(_read_yaml_dict, config_path)
    except (OSError, ValueError, yaml.YAMLError) as error:
        logger.error("Failed to read config.yml: %s", error)
        raise HTTPException(status_code=500, detail="Config file could not be read") from error


@app.post("/api/config")
@app.post("/api/data/config")
async def update_config(request: Request):
    body = await _read_limited_body(request, MAX_CONFIG_BYTES)
    try:
        parsed = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise HTTPException(
            status_code=400, detail="Config payload must be valid UTF-8 JSON"
        ) from error
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=400, detail="Config payload must be a JSON object")
    data = _validate_config_payload(parsed)
    try:
        await _run_io(_atomic_write_yaml, DATA_ROOT / "config.yml", data)
        return {"status": "ok"}
    except OSError as error:
        logger.error("Failed to write config.yml: %s", error)
        raise HTTPException(status_code=500, detail="Config file could not be saved") from error


@app.get("/api/wallpaper")
async def get_wallpaper_info():
    return {
        "source": "bing",
        "url": "https://bing.biturl.top/?resolution=1920&format=image&index=0&mkt=zh-CN",
        "copyright": "Bing Daily Wallpaper",
        "title": "Bing 每日一图",
    }


class EnvironmentRegistryEntry(BaseModel):
    value: str = ""
    description: str = ""
    secret: bool = True
    requestedBy: List[str] = Field(default_factory=list)
    createdAt: str = ""
    updatedAt: str = ""


class EnvironmentRegistryPayload(BaseModel):
    version: int = 1
    variables: Dict[str, EnvironmentRegistryEntry] = Field(default_factory=dict)


class EnvironmentRegistrationRequest(BaseModel):
    key: str
    defaultValue: str = ""
    description: str = ""
    secret: bool = True
    requestedBy: str = "unknown"


def _entry_to_dict(entry: EnvironmentRegistryEntry) -> Dict[str, Any]:
    return {
        "value": entry.value,
        "description": entry.description,
        "secret": entry.secret,
        "requestedBy": list(entry.requestedBy),
        "createdAt": entry.createdAt,
        "updatedAt": entry.updatedAt,
    }


def _normalize_environment_registry(raw: Dict[str, Any]) -> Dict[str, Any]:
    variables_raw = raw.get("variables")
    normalized: Dict[str, Dict[str, Any]] = {}

    if isinstance(variables_raw, dict):
        source_items = variables_raw.items()
    else:
        source_items = ((key, value) for key, value in raw.items() if key != "version")

    for key, value in source_items:
        if ENV_KEY_PATTERN.fullmatch(str(key)) is None:
            logger.warning("Ignoring invalid environment key in environment.yml: %s", key)
            continue

        now = _utc_now()
        if isinstance(value, dict):
            requested_by = value.get("requestedBy")
            if not isinstance(requested_by, list):
                requested_by = []
            normalized[str(key)] = {
                "value": str(value.get("value", "")),
                "description": str(value.get("description", "")),
                "secret": bool(value.get("secret", True)),
                "requestedBy": [str(item) for item in requested_by],
                "createdAt": str(value.get("createdAt", now)),
                "updatedAt": str(value.get("updatedAt", now)),
            }
        else:
            normalized[str(key)] = {
                "value": "" if value is None else str(value),
                "description": "",
                "secret": True,
                "requestedBy": ["legacy"],
                "createdAt": now,
                "updatedAt": now,
            }

    return {"version": 1, "variables": normalized}


def _read_environment_registry() -> Dict[str, Any]:
    environment_path = DATA_ROOT / "environment.yml"
    try:
        raw = _read_yaml_dict(environment_path)
    except (OSError, ValueError, yaml.YAMLError) as error:
        raise HTTPException(status_code=500, detail="Environment registry could not be read") from error
    return _normalize_environment_registry(raw)


def _write_environment_registry(registry: Dict[str, Any]) -> None:
    try:
        _atomic_write_yaml(DATA_ROOT / "environment.yml", registry)
    except OSError as error:
        raise HTTPException(status_code=500, detail="Environment registry could not be saved") from error


@app.get("/api/data/environment")
async def get_environment_values():
    registry = await _run_io(_read_environment_registry)
    return {key: entry["value"] for key, entry in registry["variables"].items()}


@app.post("/api/data/environment")
async def update_environment_values(data: Dict[str, Any]):
    registry = await _run_io(_read_environment_registry)
    now = _utc_now()
    for raw_key, raw_value in data.items():
        key = _validate_environment_key(raw_key)
        existing = registry["variables"].get(key)
        if existing is None:
            existing = {
                "value": "",
                "description": "",
                "secret": True,
                "requestedBy": ["settings"],
                "createdAt": now,
                "updatedAt": now,
            }
            registry["variables"][key] = existing
        existing["value"] = "" if raw_value is None else str(raw_value)
        existing["updatedAt"] = now
    await _run_io(_write_environment_registry, registry)
    return {"status": "ok"}


@app.get("/api/data/environment/registry")
async def get_environment_registry():
    return await _run_io(_read_environment_registry)


@app.put("/api/data/environment/registry")
async def update_environment_registry(payload: EnvironmentRegistryPayload):
    normalized_variables: Dict[str, Dict[str, Any]] = {}
    now = _utc_now()
    for raw_key, entry in payload.variables.items():
        key = _validate_environment_key(raw_key)
        normalized_entry = _entry_to_dict(entry)
        normalized_entry["createdAt"] = normalized_entry["createdAt"] or now
        normalized_entry["updatedAt"] = now
        normalized_entry["requestedBy"] = sorted(set(normalized_entry["requestedBy"]))
        normalized_variables[key] = normalized_entry
    registry = {"version": 1, "variables": normalized_variables}
    await _run_io(_write_environment_registry, registry)
    return {"status": "ok", "registry": registry}


@app.post("/api/data/environment/register")
async def register_environment_variable(request_data: EnvironmentRegistrationRequest):
    key = _validate_environment_key(request_data.key)
    registry = await _run_io(_read_environment_registry)
    now = _utc_now()
    entry = registry["variables"].get(key)
    created = entry is None

    if entry is None:
        entry = {
            "value": request_data.defaultValue,
            "description": request_data.description,
            "secret": request_data.secret,
            "requestedBy": [request_data.requestedBy],
            "createdAt": now,
            "updatedAt": now,
        }
        registry["variables"][key] = entry
    else:
        if request_data.description and not entry.get("description"):
            entry["description"] = request_data.description
        requested_by = set(str(item) for item in entry.get("requestedBy", []))
        requested_by.add(request_data.requestedBy)
        entry["requestedBy"] = sorted(requested_by)
        entry["updatedAt"] = now

    await _run_io(_write_environment_registry, registry)
    return {"status": "ok", "created": created, "key": key, "entry": entry}


@app.post("/api/data/environment/{key}")
async def ensure_environment_key(key: str, request: Request):
    validated_key = _validate_environment_key(key)
    body = await _read_limited_body(request, 64 * 1024)
    default_value = body.decode("utf-8") if body else ""
    return await register_environment_variable(
        EnvironmentRegistrationRequest(
            key=validated_key,
            defaultValue=default_value,
            requestedBy="legacy-sdk",
        )
    )


@app.delete("/api/data/environment/{key}")
async def delete_environment_key(key: str):
    validated_key = _validate_environment_key(key)
    registry = await _run_io(_read_environment_registry)
    if validated_key not in registry["variables"]:
        raise HTTPException(status_code=404, detail=f"Environment key {validated_key} was not found")
    del registry["variables"][validated_key]
    await _run_io(_write_environment_registry, registry)
    return {"status": "deleted", "key": validated_key}


@app.get("/api/data/cards")
async def list_cards():
    def _list() -> List[str]:
        if not CARDS_ROOT.is_dir():
            return []
        return sorted(
            path.stem
            for path in CARDS_ROOT.glob("*.js")
            if path.is_file() and CARD_ID_PATTERN.fullmatch(path.stem) is not None
        )

    return {"cards": await _run_io(_list)}


@app.get("/api/data/cards/{card_id}")
async def get_card(card_id: str):
    validated_id = _validate_card_id(card_id)
    js_path = _safe_child_path(CARDS_ROOT, f"{validated_id}.js")
    if js_path.is_file():
        content = await _run_io(js_path.read_bytes)
        return Response(content=content, media_type="application/javascript")

    json_path = _safe_child_path(CARDS_ROOT, f"{validated_id}.json")
    if json_path.is_file():
        content = await _run_io(json_path.read_bytes)
        return Response(content=content, media_type="application/json")

    raise HTTPException(status_code=404, detail=f"Card {validated_id} was not found")


@app.post("/api/data/cards/{card_id}")
async def save_card(card_id: str, request: Request):
    validated_id = _validate_card_id(card_id)
    body = await _read_limited_body(request, MAX_CARD_BYTES)
    card_path = _safe_child_path(CARDS_ROOT, f"{validated_id}.js")

    def _write_card():
        temporary_path = card_path.with_suffix(".js.tmp")
        temporary_path.write_bytes(body)
        os.replace(temporary_path, card_path)

        legacy_json_path = _safe_child_path(CARDS_ROOT, f"{validated_id}.json")
        if legacy_json_path.is_file():
            legacy_json_path.unlink(missing_ok=True)

    await _run_io(_write_card)
    return {"status": "ok", "card_id": validated_id}


@app.delete("/api/data/cards/{card_id}")
async def delete_card(card_id: str):
    validated_id = _validate_card_id(card_id)
    js_path = _safe_child_path(CARDS_ROOT, f"{validated_id}.js")
    json_path = _safe_child_path(CARDS_ROOT, f"{validated_id}.json")

    def _delete():
        found = False
        if js_path.is_file():
            js_path.unlink()
            found = True
        if json_path.is_file():
            json_path.unlink()
            found = True
        if not found:
            raise HTTPException(status_code=404, detail=f"Card {validated_id} was not found")
        return found

    try:
        await _run_io(_delete)
    except HTTPException:
        raise
    return {"status": "deleted", "card_id": validated_id}


def _write_cache_meta(key: str, data: Dict[str, Any]) -> None:
    try:
        meta_path = _safe_child_path(CACHE_META_ROOT, f"{key}.json")
        meta_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = meta_path.with_name(f".{meta_path.name}.{secrets.token_hex(4)}.tmp")
        temporary_path.write_text(json.dumps(data), encoding="utf-8")
        os.replace(temporary_path, meta_path)
    except OSError as error:
        logger.warning("Failed to write cache metadata for %s: %s", key, error)


def _get_expire_time_from_request(
    request: Request, body_data: Optional[Dict[str, Any]] = None
) -> float:
    now_ms = datetime.now(timezone.utc).timestamp() * 1000.0
    expire_header = request.headers.get("X-Cache-Expire-Time")
    ttl_hours_header = request.headers.get("X-TTL-Hours")
    ttl_seconds_header = request.headers.get("X-TTL-Seconds")

    expire_param = request.query_params.get("expire_time")
    ttl_hours_param = request.query_params.get("ttl_hours")
    ttl_seconds_param = request.query_params.get("ttl_seconds")

    if expire_header is not None:
        return float(expire_header)
    elif ttl_hours_header is not None:
        return now_ms + float(ttl_hours_header) * 3600.0 * 1000.0
    elif ttl_seconds_header is not None:
        return now_ms + float(ttl_seconds_header) * 1000.0
    elif expire_param is not None:
        return float(expire_param)
    elif ttl_hours_param is not None:
        return now_ms + float(ttl_hours_param) * 3600.0 * 1000.0
    elif body_data is not None and body_data.get("expireTime") is not None:
        return float(body_data["expireTime"])
    elif body_data is not None and body_data.get("ttlHours") is not None:
        return now_ms + float(body_data["ttlHours"]) * 3600.0 * 1000.0
    elif body_data is not None and body_data.get("ttlSeconds") is not None:
        return now_ms + float(body_data["ttlSeconds"]) * 1000.0
    else:
        return now_ms + 7.0 * 24.0 * 3600.0 * 1000.0


def _get_auto_extend_from_request(
    request: Request, body_data: Optional[Dict[str, Any]] = None
) -> bool:
    auto_extend_header = request.headers.get("X-Auto-Extend")
    if auto_extend_header is not None:
        return auto_extend_header.lower() not in {"false", "0", "no", "off"}
    auto_extend_param = request.query_params.get("auto_extend") or request.query_params.get("autoExtend")
    if auto_extend_param is not None:
        return auto_extend_param.lower() not in {"false", "0", "no", "off"}
    if body_data is not None:
        if "autoExtend" in body_data:
            val = body_data["autoExtend"]
            if isinstance(val, bool):
                return val
            if isinstance(val, str):
                return val.lower() not in {"false", "0", "no", "off"}
        if "auto_extend" in body_data:
            val = body_data["auto_extend"]
            if isinstance(val, bool):
                return val
            if isinstance(val, str):
                return val.lower() not in {"false", "0", "no", "off"}
    return True


class CacheDownloadRequest(BaseModel):
    url: str
    key: Optional[str] = None
    expireTime: Optional[float] = None
    ttlHours: Optional[float] = None
    ttlSeconds: Optional[float] = None
    autoExtend: Optional[bool] = None


_IMAGE_MAGIC_SIGNATURES = (
    b"\x89PNG\r\n\x1a\n",
    b"\xff\xd8\xff",
    b"GIF87a",
    b"GIF89a",
    b"\x00\x00\x01\x00",
    b"BM",
)


def _sniff_is_image(head: bytes) -> bool:
    if any(head.startswith(sig) for sig in _IMAGE_MAGIC_SIGNATURES):
        return True
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return True
    if head[4:8] == b"ftyp" and head[8:12] in (b"avif", b"avis"):
        return True
    if head.lstrip().startswith(b"<svg"):
        return True
    return False


def _is_valid_image_content(content: bytes, content_type: str) -> bool:
    if not content:
        return False
    head = content[:512]
    if _sniff_is_image(head):
        return True
    if head.lstrip().startswith(b"<"):
        return False
    mime = content_type.split(";")[0].strip().lower()
    return mime.startswith("image/")


@app.post("/api/data/cache/download")
async def download_cache_image(download_req: CacheDownloadRequest, request: Request):
    async with _proxy_semaphore:
        return await _download_cache_image_impl(download_req, request)


async def _download_cache_image_impl(download_req: CacheDownloadRequest, request: Request):
    target_url = download_req.url.strip()
    if not target_url:
        raise HTTPException(status_code=400, detail="URL must not be empty")

    now_ms = datetime.now(timezone.utc).timestamp() * 1000.0

    if target_url.startswith("/api/data/cache/") or "/api/data/cache/" in target_url:
        clean_key = target_url.split("/api/data/cache/")[-1]
        existing_cache_path = _safe_child_path(CACHE_ROOT, clean_key)
        if existing_cache_path.is_file():
            return {
                "status": "ok",
                "key": clean_key,
                "url": f"/api/data/cache/{clean_key}",
            }

    body_dict = download_req.model_dump()
    expire_time = _get_expire_time_from_request(request, body_dict)
    auto_extend = _get_auto_extend_from_request(request, body_dict)

    if download_req.key is not None and download_req.key.strip():
        key = download_req.key.strip()
    else:
        url_hash = hashlib.sha256(target_url.encode("utf-8")).hexdigest()[:16]
        key = f"downloaded/{url_hash}"

    cache_path = _safe_child_path(CACHE_ROOT, key)
    meta_path = _safe_child_path(CACHE_META_ROOT, f"{key}.json")

    existing = await _run_io(_check_existing_cache, cache_path, meta_path, key, now_ms)
    if existing is not None:
        return existing

    await _validate_proxy_target(target_url)
    try:
        response = await _get_http_client().get(
            target_url,
            headers=DEFAULT_BROWSER_HEADERS,
            follow_redirects=True,
        )
        if response.status_code != 200:
            logger.warning("Failed to download image from %s: HTTP %s", target_url, response.status_code)
            raise HTTPException(
                status_code=502,
                detail=f"Failed to download image from remote URL (HTTP {response.status_code})",
            )

        content_type = response.headers.get("content-type", "")
        if not _is_valid_image_content(response.content, content_type):
            logger.warning(
                "Rejected non-image content from %s (content-type: %s, %s bytes)",
                target_url,
                content_type,
                len(response.content),
            )
            raise HTTPException(status_code=502, detail="Remote URL did not return a valid image")
        if not content_type:
            content_type = "image/jpeg"
        if "." not in Path(key).name:
            ext = mimetypes.guess_extension(content_type.split(";")[0])
            if ext is not None:
                key = f"{key}{ext}"
                cache_path = _safe_child_path(CACHE_ROOT, key)

        # File I/O off the event loop so bursts of tile downloads stay concurrent
        await _run_io(
            _persist_downloaded_cache, cache_path, response.content, key, expire_time, auto_extend, now_ms
        )

        return {
            "status": "ok",
            "key": key,
            "url": f"/api/data/cache/{key}",
            "contentType": content_type,
            "expireTime": expire_time,
            "autoExtend": auto_extend,
        }
    except HTTPException:
        raise
    except httpx.HTTPError as error:
        logger.warning("Download image from %s failed: %s", target_url, error)
        raise HTTPException(status_code=502, detail="Failed to download image from remote URL")


def _check_existing_cache(
    cache_path: Path,
    meta_path: Path,
    key: str,
    now_ms: float,
) -> Optional[Dict[str, Any]]:
    if not cache_path.is_file() or not meta_path.is_file():
        return None
    try:
        with cache_path.open("rb") as cache_file:
            head = cache_file.read(512)
        if not _sniff_is_image(head):
            logger.warning("Evicting cached non-image content for key %s", key)
            cache_path.unlink(missing_ok=True)
            meta_path.unlink(missing_ok=True)
            return None
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        if "expire_time" in meta and float(meta["expire_time"]) > now_ms:
            return {
                "status": "ok",
                "key": key,
                "url": f"/api/data/cache/{key}",
                "expireTime": float(meta["expire_time"]),
            }
    except (OSError, json.JSONDecodeError, ValueError) as error:
        logger.warning("Failed to check existing cache meta for %s: %s", key, error)
    return None


def _persist_downloaded_cache(
    cache_path: Path,
    content: bytes,
    key: str,
    expire_time: float,
    auto_extend: bool,
    now_ms: float,
) -> None:
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = cache_path.with_name(f".{cache_path.name}.{secrets.token_hex(4)}.tmp")
    temporary_path.write_bytes(content)
    os.replace(temporary_path, cache_path)
    _write_cache_meta(key, {"expire_time": expire_time, "created_at": now_ms, "auto_extend": auto_extend})


@app.get("/api/data/cache/{key:path}")
async def get_cache(key: str):
    # All disk work happens in a worker thread; the endpoint only builds the response
    content, media_type, remaining_seconds = await _run_io(_read_cache_entry, key)
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Allow-Methods": "*",
            "Cache-Control": f"private, max-age={remaining_seconds}",
        },
    )


def _read_cache_entry(key: str) -> tuple[bytes, str, int]:
    cache_path = _safe_child_path(CACHE_ROOT, key)
    if not cache_path.is_file():
        raise HTTPException(status_code=404, detail=f"Cache key {key} was not found")

    meta_path = _safe_child_path(CACHE_META_ROOT, f"{key}.json")
    now_ms = datetime.now(timezone.utc).timestamp() * 1000.0
    expire_time: float
    auto_extend: bool = True

    if meta_path.is_file():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            if "expire_time" in meta:
                expire_time = float(meta["expire_time"])
            else:
                logger.warning("Cache metadata for %s missing expire_time", key)
                expire_time = now_ms + 7.0 * 24.0 * 3600.0 * 1000.0
            if "auto_extend" in meta:
                auto_extend = bool(meta["auto_extend"])
        except (OSError, json.JSONDecodeError, ValueError) as error:
            logger.warning("Failed to read cache metadata for %s: %s", key, error)
            expire_time = now_ms + 7.0 * 24.0 * 3600.0 * 1000.0
    else:
        mtime_ms = cache_path.stat().st_mtime * 1000.0
        expire_time = mtime_ms + 7.0 * 24.0 * 3600.0 * 1000.0
        _write_cache_meta(key, {"expire_time": expire_time, "created_at": mtime_ms, "auto_extend": True})

    stale = now_ms >= expire_time
    if stale and now_ms >= expire_time + STALE_CACHE_GRACE_MS:
        logger.warning("Cache key %s expired beyond grace period at %s (now: %s), unlinking", key, expire_time, now_ms)
        try:
            cache_path.unlink(missing_ok=True)
            if meta_path.is_file():
                meta_path.unlink(missing_ok=True)
        except OSError as error:
            logger.warning("Failed to delete expired cache key %s: %s", key, error)
        raise HTTPException(status_code=404, detail=f"Cache key {key} has expired")

    if stale:
        # 宽限期内继续提供过期内容（stale-while-revalidate）：
        # 前端可先展示旧壁纸/旧图块，再后台刷新，避免冷启动灰屏。
        # 短 max-age 让客户端尽快重新校验；不做 auto_extend，防止过期条目被"续活"。
        logger.info("Cache key %s is stale but within grace period, serving stale content", key)
        media_type = mimetypes.guess_type(cache_path.name)[0] or "application/octet-stream"
        return cache_path.read_bytes(), media_type, 60

    three_hours_ms = 3.0 * 3600.0 * 1000.0
    if auto_extend and expire_time < now_ms + three_hours_ms:
        new_expire_time = expire_time + three_hours_ms
        _write_cache_meta(key, {"expire_time": new_expire_time, "created_at": now_ms, "auto_extend": auto_extend})
        logger.info("Extended cache key %s expire_time from %s to %s", key, expire_time, new_expire_time)
        expire_time = new_expire_time

    media_type = mimetypes.guess_type(cache_path.name)[0] or "application/octet-stream"
    remaining_seconds = max(60, int((expire_time - now_ms) / 1000.0))
    return cache_path.read_bytes(), media_type, remaining_seconds


@app.post("/api/data/cache/{key:path}")
async def save_cache(key: str, request: Request):
    cache_path = _safe_child_path(CACHE_ROOT, key)
    body = await _read_limited_body(request, MAX_CACHE_BYTES)
    expire_time = _get_expire_time_from_request(request)
    auto_extend = _get_auto_extend_from_request(request)
    now_ms = datetime.now(timezone.utc).timestamp() * 1000.0

    def _write():
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = cache_path.with_name(f".{cache_path.name}.{secrets.token_hex(4)}.tmp")
        temporary_path.write_bytes(body)
        os.replace(temporary_path, cache_path)
        _write_cache_meta(key, {"expire_time": expire_time, "created_at": now_ms, "auto_extend": auto_extend})

    await _run_io(_write)
    return {"status": "ok", "key": key, "expireTime": expire_time, "autoExtend": auto_extend}


@app.delete("/api/data/cache/{key:path}")
async def delete_cache(key: str):
    cache_path = _safe_child_path(CACHE_ROOT, key)
    meta_path = _safe_child_path(CACHE_META_ROOT, f"{key}.json")

    def _delete():
        if not cache_path.is_file():
            raise HTTPException(status_code=404, detail=f"Cache key {key} was not found")
        cache_path.unlink()
        if meta_path.is_file():
            meta_path.unlink()

    try:
        await _run_io(_delete)
    except HTTPException:
        raise
    return {"status": "deleted", "key": key}


@app.get("/api/data/storage/{key:path}")
async def get_storage(key: str):
    storage_path = _safe_child_path(STORAGE_ROOT, key)

    def _read():
        if not storage_path.is_file():
            raise HTTPException(status_code=404, detail=f"Storage key {key} was not found")
        media_type = mimetypes.guess_type(storage_path.name)[0] or "application/octet-stream"
        return storage_path.read_bytes(), media_type

    try:
        content, media_type = await _run_io(_read)
    except HTTPException:
        raise
    return Response(content=content, media_type=media_type)


@app.post("/api/data/storage/{key:path}")
async def save_storage(key: str, request: Request):
    storage_path = _safe_child_path(STORAGE_ROOT, key)
    body = await _read_limited_body(request, MAX_CACHE_BYTES)

    def _write():
        storage_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = storage_path.with_name(f".{storage_path.name}.{secrets.token_hex(4)}.tmp")
        temporary_path.write_bytes(body)
        os.replace(temporary_path, storage_path)

    await _run_io(_write)
    return {"status": "ok", "key": key}


@app.delete("/api/data/storage/{key:path}")
async def delete_storage(key: str):
    storage_path = _safe_child_path(STORAGE_ROOT, key)

    def _delete():
        if not storage_path.is_file():
            raise HTTPException(status_code=404, detail=f"Storage key {key} was not found")
        storage_path.unlink()

    try:
        await _run_io(_delete)
    except HTTPException:
        raise
    return {"status": "deleted", "key": key}


def _load_webdav_credentials() -> tuple[str, str]:
    username = os.environ.get("WEBDAV_USERNAME", "admin")
    password_from_env = os.environ.get("WEBDAV_PASSWORD")
    if password_from_env:
        return username, password_from_env

    credentials_path = DATA_ROOT / ".webdav-auth.yml"
    if credentials_path.exists():
        credentials = _read_yaml_dict(credentials_path)
        stored_username = credentials.get("username")
        stored_password = credentials.get("password")
        if isinstance(stored_username, str) and isinstance(stored_password, str):
            return stored_username, stored_password

    generated_password = secrets.token_urlsafe(24)
    _atomic_write_yaml(credentials_path, {"username": username, "password": generated_password})
    try:
        os.chmod(credentials_path, 0o600)
    except OSError:
        logger.warning("Could not restrict permissions for %s", credentials_path)
    logger.warning("Created WebDAV credentials at %s", credentials_path)
    return username, generated_password


WEBDAV_USERNAME, WEBDAV_PASSWORD = _load_webdav_credentials()


# ── 应用令牌与系统控制 ──────────────────────────────────────
# 用于保护 shutdown/restart/autostart 等本机敏感端点：
# 令牌只在首次运行时生成并写入数据目录，经 /api/system/info 暴露给前端。
# 跨站点网页因 CORS 无法读取该令牌，自定义请求头又会触发预检失败，
# 因此无法对本机服务发起 drive-by 关闭。
def _load_app_token() -> str:
    token_from_env = os.environ.get("APP_TOKEN")
    if token_from_env:
        return token_from_env

    token_path = DATA_ROOT / ".app-token.yml"
    if token_path.exists():
        credentials = _read_yaml_dict(token_path)
        stored_token = credentials.get("token")
        if isinstance(stored_token, str) and stored_token:
            return stored_token

    generated_token = secrets.token_urlsafe(32)
    _atomic_write_yaml(token_path, {"token": generated_token})
    try:
        os.chmod(token_path, 0o600)
    except OSError:
        logger.warning("Could not restrict permissions for %s", token_path)
    return generated_token


APP_TOKEN = _load_app_token()


def _require_app_token(request: Request) -> None:
    provided = request.headers.get("X-App-Token", "")
    if not provided or not secrets.compare_digest(provided, APP_TOKEN):
        raise HTTPException(status_code=403, detail="A valid X-App-Token header is required")


def _relaunch_command() -> List[str]:
    if _is_packaged():
        return [str(_executable_path())]
    return [sys.executable, str(APP_DIR / "main.py")]


RELAUNCH_HELPER_FLAG = "--relaunch-helper"


def _spawn_quiet(command: List[str]) -> None:
    if os.name == "nt":
        subprocess.Popen(
            command,
            creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
            close_fds=True,
        )
    else:
        subprocess.Popen(
            command,
            start_new_session=True,
            close_fds=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


def _spawn_detached_relauncher(delay_seconds: float = 2.0) -> None:
    helper = _relaunch_command() + [RELAUNCH_HELPER_FLAG, str(delay_seconds)] + _relaunch_command()
    _spawn_quiet(helper)


def _run_relaunch_helper(arguments: List[str]) -> None:
    import time

    delay_seconds = float(arguments[0])
    target = arguments[1:]
    time.sleep(delay_seconds)
    _spawn_quiet(target)


def _schedule_exit(delay_seconds: float = 0.8) -> None:
    # 先让响应返回给客户端，再结束进程
    threading.Timer(delay_seconds, lambda: os._exit(0)).start()


AUTOSTART_REG_SUBKEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
AUTOSTART_VALUE_NAME = "NewerTabX"


def _autostart_supported() -> bool:
    # 开发模式下写注册表没有意义（指向 python 解释器+脚本，且路径易变）
    return os.name == "nt" and _is_packaged()


def _get_autostart_enabled() -> bool:
    if not _autostart_supported():
        return False
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, AUTOSTART_REG_SUBKEY) as key:
            value, _ = winreg.QueryValueEx(key, AUTOSTART_VALUE_NAME)
            return isinstance(value, str) and bool(value.strip())
    except OSError:
        return False


def _set_autostart_enabled(enabled: bool) -> None:
    import winreg

    with winreg.OpenKey(
        winreg.HKEY_CURRENT_USER, AUTOSTART_REG_SUBKEY, 0, winreg.KEY_SET_VALUE
    ) as key:
        if enabled:
            winreg.SetValueEx(key, AUTOSTART_VALUE_NAME, 0, winreg.REG_SZ, str(_executable_path()))
        else:
            try:
                winreg.DeleteValue(key, AUTOSTART_VALUE_NAME)
            except FileNotFoundError:
                pass

wsgidav_config = {
    "provider_mapping": {"/": str(DATA_ROOT)},
    "simple_dc": {
        "user_mapping": {
            "*": {
                WEBDAV_USERNAME: {
                    "password": WEBDAV_PASSWORD,
                    "roles": ["admin"],
                }
            }
        }
    },
    "http_authenticator": {
        "accept_basic": True,
        "accept_digest": True,
        "default_to_digest": False,
    },
    "dir_browser": {"enable": False},
    "verbose": 1,
}
app.mount("/webdav", WSGIMiddleware(WsgiDAVApp(wsgidav_config)))


@app.get("/api/system/info")
async def get_system_info():
    return {
        "dataRoot": str(DATA_ROOT),
        "webdavPath": "/webdav",
        "webdavUsername": WEBDAV_USERNAME,
        "staticReady": (FRONTEND_DIST / "index.html").is_file(),
        "appToken": APP_TOKEN,
        "version": APP_VERSION,
        "updateRepoConfigured": bool(GITHUB_REPO),
        "packaged": _is_packaged(),
        "autostartSupported": _autostart_supported(),
        "autostartEnabled": _get_autostart_enabled(),
    }


@app.post("/api/system/shutdown")
async def shutdown_backend(request: Request):
    _require_app_token(request)
    _schedule_exit()
    return {"status": "shutting_down"}


@app.post("/api/system/restart")
async def restart_backend(request: Request):
    _require_app_token(request)
    _spawn_detached_relauncher()
    _schedule_exit()
    return {"status": "restarting"}


class AutostartRequest(BaseModel):
    enabled: bool


@app.post("/api/system/autostart")
async def set_autostart(payload: AutostartRequest, request: Request):
    _require_app_token(request)
    if not _autostart_supported():
        raise HTTPException(
            status_code=400,
            detail="Autostart is only supported in the packaged Windows build",
        )
    try:
        _set_autostart_enabled(payload.enabled)
    except OSError as error:
        logger.error("Failed to update autostart registry entry: %s", error)
        raise HTTPException(status_code=500, detail="Autostart registry update failed") from error
    return {"status": "ok", "enabled": payload.enabled}


# ── 更新检查（只读，下载/安装在第三期实现）──────────────────
_UPDATE_CHECK_CACHE_TTL_SECONDS = 3600.0
_update_check_cache: Optional[Dict[str, Any]] = None
_update_check_cache_at: float = 0.0


def _parse_version_tag(tag: str) -> Optional[tuple]:
    """把 "v1.2.3" / "1.2.3-beta" 解析成可比较的元组；无法解析返回 None。"""
    core = tag.strip().lstrip("vV").split("-", 1)[0]
    parts = []
    for segment in core.split("."):
        if not segment.isdigit():
            return None
        parts.append(int(segment))
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts)


@app.get("/api/system/update/check")
async def check_for_updates(request: Request):
    """查询 GitHub Releases 最新版本并与当前版本比较。结果缓存 1 小时避免触发限流。"""
    global _update_check_cache, _update_check_cache_at

    _require_app_token(request)
    if not GITHUB_REPO:
        raise HTTPException(
            status_code=400,
            detail="Update repository is not configured; set GITHUB_REPO or app-meta.json repo",
        )

    now = datetime.now(timezone.utc).timestamp()
    if _update_check_cache is not None and now - _update_check_cache_at < _UPDATE_CHECK_CACHE_TTL_SECONDS:
        return _update_check_cache

    try:
        client = _get_http_client()
        response = await client.get(
            f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest",
            headers={
                "Accept": "application/vnd.github+json",
                "User-Agent": f"NewerTabX/{APP_VERSION}",
            },
        )
    except httpx.HTTPError as error:
        logger.warning("Update check request failed: %s", error)
        raise HTTPException(status_code=502, detail="Update check request failed") from error

    if response.status_code == 404:
        result: Dict[str, Any] = {
            "currentVersion": APP_VERSION,
            "latestVersion": None,
            "updateAvailable": False,
            "releaseUrl": None,
            "publishedAt": None,
            "assets": [],
        }
    elif response.status_code != 200:
        raise HTTPException(status_code=502, detail=f"GitHub Releases returned HTTP {response.status_code}")
    else:
        release = response.json()
        latest_tag = str(release.get("tag_name", ""))
        current_parsed = _parse_version_tag(APP_VERSION)
        latest_parsed = _parse_version_tag(latest_tag)
        update_available = (
            current_parsed is not None
            and latest_parsed is not None
            and latest_parsed > current_parsed
        )
        result = {
            "currentVersion": APP_VERSION,
            "latestVersion": latest_tag or None,
            "updateAvailable": update_available,
            "releaseUrl": release.get("html_url"),
            "publishedAt": release.get("published_at"),
            "assets": [
                {
                    "name": asset.get("name"),
                    "size": asset.get("size"),
                    "downloadUrl": asset.get("browser_download_url"),
                }
                for asset in release.get("assets", [])
                if isinstance(asset, dict)
            ],
        }

    _update_check_cache = result
    _update_check_cache_at = now
    return result


if (FRONTEND_DIST / "index.html").is_file():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="static")
else:
    @app.get("/")
    async def frontend_not_built():
        return JSONResponse(
            status_code=503,
            content={
                "detail": "Frontend assets are not built. Run `npm run build` in the frontend directory and restart the backend.",
            },
        )


HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "38080"))


def _ensure_single_instance() -> None:
    """已有实例在运行时：直接把浏览器指过去并退出，实现"二次启动 = 打开页面"。"""
    probe_url = f"http://{HOST}:{PORT}/api/system/info"
    try:
        with urllib.request.urlopen(probe_url, timeout=1.5) as response:
            if response.status == 200:
                logger.info("Another instance is already running on %s:%s, opening browser instead", HOST, PORT)
                webbrowser.open(f"http://{HOST}:{PORT}/")
                sys.exit(0)
    except OSError:
        # 连接被拒绝/超时：端口空闲，正常启动
        return


def _run_server() -> None:
    import uvicorn

    dev_mode = not _is_packaged() and os.environ.get("DEV", "") == "1"
    try:
        if dev_mode:
            # reload 需要以导入字符串方式加载应用
            uvicorn.run("main:app", host=HOST, port=PORT, reload=True)
        else:
            uvicorn.run(app, host=HOST, port=PORT, reload=False)
    except OSError as error:
        # 与单实例探测之间的竞态兜底：绑定失败说明端口刚被别的实例抢占
        logger.warning("Failed to bind %s:%s (%s), opening browser instead", HOST, PORT, error)
        webbrowser.open(f"http://{HOST}:{PORT}/")
        sys.exit(0)


if __name__ == "__main__":
    if RELAUNCH_HELPER_FLAG in sys.argv:
        flag_index = sys.argv.index(RELAUNCH_HELPER_FLAG)
        _run_relaunch_helper(sys.argv[flag_index + 1:])
        sys.exit(0)
    _ensure_single_instance()
    _run_server()
