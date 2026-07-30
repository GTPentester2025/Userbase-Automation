import io

import pandas as pd
from fastapi.testclient import TestClient
from engine import config
from server import create_app


def dm_file():
    df = pd.DataFrame({c: ["v1", "v2", "v3"] for c in config.REQUIRED_COLUMNS})
    df["Employee Email"] = ["a@x.y", "", "a@x.y"]
    buf = io.BytesIO()
    df.to_excel(buf, index=False)
    return ("dm.xlsx", buf.getvalue(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


def client(tmp_path):
    return TestClient(create_app(tmp_path / "runs"))


def test_create_run_and_advance(tmp_path):
    c = client(tmp_path)
    r = c.post("/api/runs", files={"file": dm_file()})
    assert r.status_code == 200
    rid = r.json()["run_id"]
    assert c.post(f"/api/runs/{rid}/advance").status_code == 200  # stage 1
    r = c.post(f"/api/runs/{rid}/run-all")
    assert r.json()["blocked_on"] == ["o365"]


def test_preview_and_download(tmp_path):
    c = client(tmp_path)
    rid = c.post("/api/runs", files={"file": dm_file()}).json()["run_id"]
    c.post(f"/api/runs/{rid}/run-all")
    r = c.get(f"/api/runs/{rid}/stages/3/preview", params={"kind": "removed"})
    assert r.status_code == 200 and r.json()["total"] == 1
    r = c.get(f"/api/runs/{rid}/stages/3/download", params={"kind": "kept", "fmt": "csv"})
    assert r.status_code == 200


def test_replace_supersedes(tmp_path):
    c = client(tmp_path)
    rid = c.post("/api/runs", files={"file": dm_file()}).json()["run_id"]
    c.post(f"/api/runs/{rid}/run-all")  # through stage 4
    df = pd.DataFrame({c2: ["z"] for c2 in config.REQUIRED_COLUMNS})
    df["Employee Email"] = ["only@x.y"]
    buf = io.BytesIO()
    df.to_csv(buf, index=False)
    r = c.post(f"/api/runs/{rid}/stages/3/replace",
               files={"file": ("fix.csv", buf.getvalue(), "text/csv")})
    assert r.status_code == 200
    m = c.get(f"/api/runs/{rid}").json()
    assert m["frontier"] == 4 and "4" not in m["stages"]


def test_advance_without_input_409(tmp_path):
    c = client(tmp_path)
    r = c.post("/api/runs", files={"file": dm_file()})
    rid = r.json()["run_id"]
    c.post(f"/api/runs/{rid}/run-all")
    assert c.post(f"/api/runs/{rid}/advance").status_code == 409
