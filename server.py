import io
import shutil
import zipfile
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from engine import pipeline
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
    def create_run(file: UploadFile):
        rid = store.create_run()
        store.save_upload_stream(rid, "datamart", file.filename, file.file)
        return {"run_id": rid, "manifest": store.manifest(rid)}

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

    @app.post("/api/runs/{rid}/advance")
    def advance(rid: str):
        try:
            return pipeline.advance(store, rid)
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

    web = Path(__file__).parent / "web"
    if web.exists():
        app.mount("/", StaticFiles(directory=web, html=True))
    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)
