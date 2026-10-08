import logging
import os
import threading

from .api import make_server
from .auth import TokenValidator
from .config import Config
from .engine import Engine
from .sliceosm import SliceClient
from .store import Store


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    cfg = Config.from_env()
    os.makedirs(cfg.data_dir, exist_ok=True)
    store = Store(os.path.join(cfg.data_dir, "jobs.sqlite"))
    engine = Engine(cfg, store, SliceClient(cfg.slice_url, cfg.files_base_url, cfg.http_timeout))
    engine.recover()
    threading.Thread(target=engine.run_forever, name="worker", daemon=True).start()
    server = make_server(engine, TokenValidator(cfg.backend_origin, cfg.auth_ttl), cfg.host, cfg.port)
    server.serve_forever()


if __name__ == "__main__":
    main()
