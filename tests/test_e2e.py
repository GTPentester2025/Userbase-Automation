from fastapi.testclient import TestClient
from scripts.make_dummy_inputs import build
from server import create_app


def test_full_pipeline(tmp_path):
    files = build(tmp_path / "inputs")
    c = TestClient(create_app(tmp_path / "runs"))
    rid = c.post("/api/runs",
                 files={"file": ("dm.xlsx", files["datamart"].read_bytes())}).json()["run_id"]
    for slot in ["o365", "saviynt", "zone_MAZ", "zone_SAZ", "aurora", "bsc", "ceo"]:
        assert c.post(f"/api/runs/{rid}/inputs/{slot}",
                      files={"file": (f"{slot}.xlsx", files[slot].read_bytes())}).status_code == 200
    r = c.post(f"/api/runs/{rid}/run-all").json()
    assert r["blocked_on"] is None
    m = c.get(f"/api/runs/{rid}").json()
    assert m["status"] == "complete"
    # accounting invariant: initial rows == final kept + total removed - total added
    s = m["stages"]
    initial = s["1"]["rows"]
    removed = sum(v["removed"] for v in s.values())
    added = sum(v["added"] for v in s.values())
    assert s["14"]["rows"] == initial - removed + added
    # spot checks
    assert s["3"]["removed"] == 10          # 5 blank + 3 noemail + 2 no-@
    assert s["7"]["removed"] >= 1           # MAZ Terminate user
    assert s["8"]["added"] == 2             # MAZ additional tab
    assert s["10"]["added"] == 2 and s["11"]["added"] == 1
    assert s["12"]["removed"] == 2          # email hit + O365 SSOUPN hit
    assert s["13"]["removed"] == 3          # 4 dup rows -> keep first
    # final files exist and download
    r = c.get(f"/api/runs/{rid}/stages/14/download", params={"kind": "kept", "fmt": "xlsx"})
    assert r.status_code == 200
    assert c.get(f"/api/runs/{rid}/logs.zip").status_code == 200
