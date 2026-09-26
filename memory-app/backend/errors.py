"""One error shape for the whole API: {"error": ..., "problems": [...]}.

Tracebacks go to the server log only; clients only ever see named problems.
"""

import json
import logging
from dataclasses import asdict, dataclass

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("memchat")


@dataclass
class Problem:
    service: str  # "qdrant" | "groq" | "embeddings" | "backend" | "notes"
    message: str
    hint: str | None = None


class AppError(Exception):
    def __init__(self, status: int, error: str, problems: list[Problem]):
        super().__init__("; ".join(p.message for p in problems))
        self.status = status
        self.error = error
        self.problems = problems


class ServiceUnavailable(AppError):
    def __init__(self, problems: list[Problem]):
        super().__init__(503, "service_unavailable", problems)


def not_found() -> AppError:
    # Deliberately identical for "does not exist" and "belongs to someone else",
    # so the response never confirms that another user's note id is real.
    return AppError(404, "not_found", [Problem("notes", "That note does not exist")])


def conflict(title: str) -> AppError:
    return AppError(
        409,
        "conflict",
        [Problem("notes", f'"{title}" was changed since you opened it', "Reload the note to see the latest version.")],
    )


def bad_request(message: str) -> AppError:
    return AppError(400, "bad_request", [Problem("notes", message)])


def problems_response(status: int, error: str, problems: list[Problem]) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": error, "problems": [asdict(p) for p in problems]})


UNEXPECTED = Problem("backend", "The backend hit an unexpected error", "Details are in the backend log.")


def register(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def on_app_error(_: Request, exc: AppError) -> JSONResponse:
        return problems_response(exc.status, exc.error, exc.problems)

    @app.exception_handler(RequestValidationError)
    async def on_invalid(_: Request, exc: RequestValidationError) -> JSONResponse:
        fields = ", ".join(str(e["loc"][-1]) for e in exc.errors())
        body = {
            "error": "invalid_request",
            "problems": [asdict(Problem("backend", f"The request is missing or has an invalid {fields}"))],
            # Field-level detail for API clients such as curl.
            "detail": json.loads(json.dumps(exc.errors(), default=str)),
        }
        return JSONResponse(status_code=422, content=body)

    @app.exception_handler(StarletteHTTPException)
    async def on_http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        # Unknown routes and wrong methods, in the same shape as everything else.
        return problems_response(exc.status_code, "http_error", [Problem("backend", str(exc.detail))])

    @app.exception_handler(Exception)
    async def on_unexpected(request: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled error on %s %s", request.method, request.url.path, exc_info=exc)
        return problems_response(500, "internal_error", [UNEXPECTED])
