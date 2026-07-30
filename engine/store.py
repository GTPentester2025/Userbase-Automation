import json
import shutil
from datetime import datetime
from pathlib import Path

import pandas as pd

from engine import config
from engine.types import StageResult


class RunStore:
    def __init__(self, base_dir):
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _mpath(self, run_id):
        return self.base_dir / run_id / "manifest.json"

    def create_run(self, mode: str = "full", zone_filter=None) -> str:
        stamp = datetime.now().strftime("run_%Y-%m-%d_%H%M%S")
        run_id, i = stamp, 1
        while (self.base_dir / run_id).exists():
            i += 1
            run_id = f"{stamp}_{i}"
        (self.base_dir / run_id / "uploads").mkdir(parents=True)
        m = {
            "run_id": run_id,
            "created": datetime.now().isoformat(),
            "status": "idle",
            "frontier": 1,
            "mode": mode,                 # "full" | "single_zone"
            "zone_filter": zone_filter,   # {"column": ..., "value": ...} | None
            "inputs": {s: None for s in config.INPUT_SLOTS},
            "stages": {},
            "error": None,
        }
        self.save_manifest(run_id, m)
        return run_id

    def clear_input(self, run_id, slot):
        """Un-set an input slot so a wrong file can be replaced before it is used."""
        m = self.manifest(run_id)
        if slot in m["inputs"]:
            m["inputs"][slot] = None
            self.save_manifest(run_id, m)
        return m

    def set_zone_filter(self, run_id, column, value):
        m = self.manifest(run_id)
        m["mode"] = "single_zone"
        m["zone_filter"] = {"column": column, "value": value}
        self.save_manifest(run_id, m)
        return m

    def manifest(self, run_id) -> dict:
        return json.loads(self._mpath(run_id).read_text(encoding="utf-8"))

    def save_manifest(self, run_id, m):
        self._mpath(run_id).write_text(json.dumps(m, indent=2), encoding="utf-8")

    def list_runs(self):
        out = []
        for p in sorted(self.base_dir.glob("run_*"), reverse=True):
            if (p / "manifest.json").exists():
                out.append(self.manifest(p.name))
        return out

    def _upload_dest(self, run_id, slot, filename) -> tuple[str, Path]:
        ts = datetime.now().strftime("%H%M%S")
        rel = f"uploads/{ts}_{slot}_{filename}"
        return rel, self.base_dir / run_id / rel

    def save_upload(self, run_id, slot, filename, data: bytes) -> str:
        if slot not in config.INPUT_SLOTS:
            raise ValueError(f"Unknown input slot: {slot}")
        rel, p = self._upload_dest(run_id, slot, filename)
        p.write_bytes(data)
        m = self.manifest(run_id)
        m["inputs"][slot] = rel
        self.save_manifest(run_id, m)
        return str(p)

    def save_upload_stream(self, run_id, slot, filename, fileobj) -> str:
        """Stream an upload to disk in 1 MB chunks — constant memory regardless of
        file size, so a 200k-row × 50-col Datamart never has to sit fully in RAM."""
        if slot not in config.INPUT_SLOTS:
            raise ValueError(f"Unknown input slot: {slot}")
        rel, p = self._upload_dest(run_id, slot, filename)
        try:
            fileobj.seek(0)
        except Exception:
            pass
        with p.open("wb") as out:
            shutil.copyfileobj(fileobj, out, length=1024 * 1024)
        m = self.manifest(run_id)
        m["inputs"][slot] = rel
        self.save_manifest(run_id, m)
        return str(p)

    def input_path(self, run_id, slot):
        rel = self.manifest(run_id)["inputs"].get(slot)
        return (self.base_dir / run_id / rel) if rel else None

    def stage_dir(self, run_id, n, key) -> Path:
        p = self.base_dir / run_id / f"stage_{n:02d}_{key}"
        p.mkdir(parents=True, exist_ok=True)
        return p

    def _find_stage_dir(self, run_id, n):
        hits = list((self.base_dir / run_id).glob(f"stage_{n:02d}_*"))
        return hits[0] if hits else None

    def save_stage(self, run_id, n, key, result: StageResult):
        d = self.stage_dir(run_id, n, key)
        result.kept.astype(str).to_parquet(d / "kept.parquet")
        if result.removed is not None:
            result.removed.astype(str).to_parquet(d / "removed.parquet")
        if result.added is not None:
            result.added.astype(str).to_parquet(d / "added.parquet")
        (d / "log.json").write_text(
            json.dumps({"stats": result.stats, "log_lines": result.log_lines},
                       indent=2, default=str),
            encoding="utf-8",
        )
        m = self.manifest(run_id)
        m["stages"][str(n)] = {
            "status": "done",
            "key": key,
            "rows": len(result.kept),
            "removed": 0 if result.removed is None else len(result.removed),
            "added": 0 if result.added is None else len(result.added),
            "stats": json.loads(json.dumps(result.stats, default=str)),
            "log_lines": result.log_lines,
        }
        m["frontier"] = max(m["frontier"], n + 1)
        self.save_manifest(run_id, m)

    def load_kept(self, run_id, upto_n) -> pd.DataFrame:
        for n in range(upto_n, 0, -1):
            d = self._find_stage_dir(run_id, n)
            if d and (d / "kept.parquet").exists():
                return pd.read_parquet(d / "kept.parquet")
        raise FileNotFoundError("No completed stage snapshot found")

    def load_frame(self, run_id, n, kind) -> pd.DataFrame:
        d = self._find_stage_dir(run_id, n)
        f = d / f"{kind}.parquet" if d else None
        return pd.read_parquet(f) if f and f.exists() else pd.DataFrame()

    def supersede(self, run_id, from_n):
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        m = self.manifest(run_id)
        for n in [int(k) for k in list(m["stages"]) if int(k) >= from_n]:
            d = self._find_stage_dir(run_id, n)
            if d:
                sup = d / f"superseded_{ts}"
                sup.mkdir(exist_ok=True)
                for f in list(d.iterdir()):
                    if f.is_file():
                        shutil.move(str(f), str(sup / f.name))
            del m["stages"][str(n)]
        m["frontier"] = from_n
        m["error"] = None
        if m["status"] != "running":
            m["status"] = "idle"
        self.save_manifest(run_id, m)

    def download_path(self, run_id, n, kind, fmt) -> Path:
        d = self._find_stage_dir(run_id, n)
        if not d or not (d / f"{kind}.parquet").exists():
            raise FileNotFoundError(f"No {kind} data at stage {n}")
        out = d / f"{kind}.{fmt}"
        if not out.exists():
            df = pd.read_parquet(d / f"{kind}.parquet")
            if fmt == "csv":
                df.to_csv(out, index=False, encoding="utf-8-sig")
            else:
                from engine.io_utils import write_xlsx

                write_xlsx(df, out, kind.capitalize())
        return out
