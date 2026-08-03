import io
import shutil
import zipfile
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from engine import config, pipeline
from engine.io_utils import read_table
from engine.store import RunStore
from engine.types import StageResult

PAGE_SIZE = 200


def create_app(runs_dir=None) -> FastAPI:
    store = RunStore(runs_dir or Path(__file__).parent / "runs")
    app = FastAPI(title="Userbase Automation")

    def stage_meta(rid):
        return [
            {"n": s.n, "key": s.key, "title": s.title, "needs": s.needs,
             "missing": pipeline.missing_inputs(store, rid, s.n)}
            for s in pipeline.STAGES
        ]

    @app.post("/api/runs")
    def create_run(file: UploadFile, mode: str = "full"):
        rid = store.create_run(mode=mode if mode in ("full", "single_zone") else "full")
        store.save_upload_stream(rid, "datamart", file.filename, file.file)
        return {"run_id": rid, "manifest": store.manifest(rid)}

    @app.get("/api/runs/{rid}/zone-values")
    def zone_values(rid: str):
        """Distinct values (+ counts) of the single-zone filter column in the
        uploaded Datamart, for the zone picker."""
        path = store.input_path(rid, "datamart")
        if not path:
            raise HTTPException(400, "No Datamart uploaded yet")
        df = read_table(path, 0)
        col = config.ZONE_FILTER_COLUMN
        if col not in df.columns:
            raise HTTPException(400, f"Datamart has no '{col}' column")
        counts = df[col].fillna("").astype(str).str.strip().value_counts()
        return {"column": col,
                "values": [{"value": v, "count": int(c)} for v, c in counts.items() if v]}

    @app.post("/api/runs/{rid}/zone-filter")
    def set_zone_filter(rid: str, value: str):
        if store.manifest(rid)["stages"]:
            raise HTTPException(409, "Cannot change the zone after Stage 1 has run")
        return store.set_zone_filter(rid, config.ZONE_FILTER_COLUMN, value)

    @app.get("/api/runs")
    def list_runs():
        return store.list_runs()

    @app.get("/api/runs/{rid}")
    def get_run(rid: str):
        try:
            m = store.manifest(rid)
        except FileNotFoundError:
            raise HTTPException(404, "run not found")
        m["stage_meta"] = stage_meta(rid)
        return m

    @app.post("/api/runs/{rid}/inputs/{slot}")
    def upload_input(rid: str, slot: str, file: UploadFile):
        try:
            store.save_upload_stream(rid, slot, file.filename, file.file)
        except ValueError as e:
            raise HTTPException(400, str(e))
        return store.manifest(rid)

    @app.post("/api/runs/{rid}/inputs/{slot}/clear")
    def clear_input(rid: str, slot: str):
        return store.clear_input(rid, slot)

    @app.post("/api/runs/{rid}/advance")
    def advance(rid: str):
        try:
            return pipeline.advance(store, rid)
        except pipeline.PipelineError as e:
            raise HTTPException(409, str(e))

    @app.post("/api/runs/{rid}/stages/{n}/skip")
    def skip(rid: str, n: int):
        try:
            return pipeline.skip_stage(store, rid, n)
        except pipeline.PipelineError as e:
            raise HTTPException(409, str(e))

    @app.post("/api/runs/{rid}/run-all")
    def run_all(rid: str):
        try:
            done = pipeline.run_all(store, rid)
        except pipeline.PipelineError as e:
            raise HTTPException(409, str(e))
        frontier = store.manifest(rid)["frontier"]
        blocked = pipeline.missing_inputs(store, rid, frontier) if frontier <= 14 else None
        return {"completed": done, "blocked_on": blocked or None}

    @app.get("/api/runs/{rid}/stages/{n}/preview")
    def preview(rid: str, n: int, kind: str = "kept", page: int = 1, q: str = ""):
        df = store.load_frame(rid, n, kind)
        if q:
            mask = df.apply(
                lambda col: col.astype(str).str.contains(q, case=False, na=False, regex=False)
            ).any(axis=1)
            df = df[mask]
        total = len(df)
        pages = max(1, -(-total // PAGE_SIZE))
        page = min(max(1, page), pages)
        sl = df.iloc[(page - 1) * PAGE_SIZE: page * PAGE_SIZE]
        return {"columns": list(df.columns), "rows": sl.astype(str).values.tolist(),
                "total": total, "page": page, "pages": pages}

    @app.get("/api/runs/{rid}/stages/{n}/download")
    def download(rid: str, n: int, kind: str = "kept", fmt: str = "xlsx"):
        if fmt not in ("xlsx", "csv"):
            raise HTTPException(400, "fmt must be xlsx or csv")
        try:
            p = store.download_path(rid, n, kind, fmt)
        except FileNotFoundError as e:
            raise HTTPException(404, str(e))
        return FileResponse(p, filename=f"stage_{n:02d}_{kind}.{fmt}")

    @app.get("/api/runs/{rid}/final/{name}")
    def final_file(rid: str, name: str):
        """Download a Stage 14 output (Final Userbase.xlsx / Removed_Users_Report.xlsx
        / Automation_Report.xlsx). Filename is basename-sanitised to stay in final/."""
        safe = Path(name).name
        p = store.base_dir / rid / "final" / safe
        if not p.exists():
            raise HTTPException(404, "final file not found")
        return FileResponse(p, filename=safe)

    @app.post("/api/runs/{rid}/stages/{n}/replace")
    def replace(rid: str, n: int, file: UploadFile):
        ts = datetime.now().strftime("%H%M%S")
        p = store.base_dir / rid / "uploads" / f"{ts}_replacement_stage{n:02d}_{file.filename}"
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("wb") as out:
            shutil.copyfileobj(file.file, out, length=1024 * 1024)
        try:
            df = read_table(p, 0)
        except Exception as e:
            raise HTTPException(400, f"Could not read replacement file: {e}")
        store.supersede(rid, n)
        store.save_stage(rid, n, "replaced", StageResult(
            kept=df,
            stats={"rows": len(df), "source": "user replacement"},
            log_lines=[f"Working file replaced by user upload ({len(df)} rows); "
                       f"stages after {n} superseded"],
        ))
        return store.manifest(rid)

    @app.get("/api/runs/{rid}/logs.zip")
    def logs_zip(rid: str):
        root = store.base_dir / rid
        if not root.exists():
            raise HTTPException(404, "run not found")
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for f in root.rglob("*"):
                if f.is_file():
                    z.write(f, f.relative_to(root))
        buf.seek(0)
        return StreamingResponse(
            buf, media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{rid}_logs.zip"'},
        )

    # Force browsers to revalidate the UI assets every load. StaticFiles already
    # returns ETag/Last-Modified (so revalidation is a cheap 304), but without a
    # Cache-Control header browsers apply heuristic caching and keep serving a
    # stale app.js/styles.css after a redeploy — which looks like "the new button
    # isn't there". no-cache = use the cached copy only after revalidating.
    @app.middleware("http")
    async def _revalidate_ui(request, call_next):
        resp = await call_next(request)
        path = request.url.path
        if path == "/" or path.endswith((".html", ".js", ".css")):
            resp.headers["Cache-Control"] = "no-cache"
        return resp

    web = Path(__file__).parent / "web"
    if web.exists():
        app.mount("/", StaticFiles(directory=web, html=True))
    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)
