"""Run the CDN daemon with ``python -m argus_cdn``."""

from __future__ import annotations

import uvicorn

from .config import load_settings
from .main import create_app
from .observability import configure_logging


def main() -> None:
    settings = load_settings()
    configure_logging()
    uvicorn.run(
        create_app(settings),
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level.lower(),
        # The JSON request logger is the access log; uvicorn's default access
        # log would print query strings, including draft tokens.
        access_log=False,
    )


if __name__ == "__main__":
    main()
