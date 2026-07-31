import io

import pandas as pd
from fastapi.testclient import TestClient
from engine import config
from engine.stages import aurora
from server import create_app

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def client(tmp_path):
    return TestClient(create_app(tmp_path / "runs"))


def dm_file(emails=("a@x.y", "b@x.y", "c@x.y")):
    df = pd.DataFrame({c: ["v"] * len(emails) for c in config.REQUIRED_COLUMNS})
    df["Employee Email"] = list(emails)
    buf = io.BytesIO()
    df.to_excel(buf, index=False)
    return ("dm.xlsx", buf.getvalue(), XLSX)


def dm_zoned():
    df = pd.DataFrame({c: ["v"] * 4 for c in config.REQUIRED_COLUMNS})
    df[config.ZONE_FILTER_COLUMN] = ["MAZ", "MAZ", "SAZ", "SAZ"]
    df["Employee Email"] = ["a@x.y", "b@x.y", "c@x.y", "d@x.y"]
    buf = io.BytesIO()
    df.to_excel(buf, index=False)
    return ("dm.xlsx", buf.getvalue(), XLSX)


# ---- Skip ----
def test_skip_stage_passthrough(tmp_path):
    c = client(tmp_path)
    rid = c.post("/api/runs", files={"file": dm_file()}).json()["run_id"]
    c.post(f"/api/runs/{rid}/advance")            # stage 1
    r = c.post(f"/api/runs/{rid}/stages/2/skip")  # skip Base Userbase
    assert r.status_code == 200 and r.json().get("skipped") is True
    m = c.get(f"/api/runs/{rid}").json()
    assert m["stages"]["2"]["skipped"] is True and m["frontier"] == 3


def test_stage1_cannot_be_skipped(tmp_path):
    c = client(tmp_path)
    rid = c.post("/api/runs", files={"file": dm_file()}).json()["run_id"]
    assert c.post(f"/api/runs/{rid}/stages/1/skip").status_code == 409


# ---- Clear input ----
def test_clear_input(tmp_path):
    c = client(tmp_path)
    rid = c.post("/api/runs", files={"file": dm_file()}).json()["run_id"]
    buf = io.BytesIO()
    pd.DataFrame({"Mail": ["a@x.y"], "UserPrincipalName": ["u@ad"]}).to_excel(buf, index=False)
    c.post(f"/api/runs/{rid}/inputs/o365", files={"file": ("o.xlsx", buf.getvalue(), XLSX)})
    assert c.get(f"/api/runs/{rid}").json()["inputs"]["o365"]
    c.post(f"/api/runs/{rid}/inputs/o365/clear")
    assert c.get(f"/api/runs/{rid}").json()["inputs"]["o365"] is None


# ---- Single-zone run ----
def test_single_zone_filters_other_zones(tmp_path):
    c = client(tmp_path)
    rid = c.post("/api/runs?mode=single_zone", files={"file": dm_zoned()}).json()["run_id"]
    vals = {v["value"]: v["count"] for v in c.get(f"/api/runs/{rid}/zone-values").json()["values"]}
    assert vals == {"MAZ": 2, "SAZ": 2}
    c.post(f"/api/runs/{rid}/zone-filter", params={"value": "MAZ"})
    c.post(f"/api/runs/{rid}/advance")            # stage 1 pre-filter
    m = c.get(f"/api/runs/{rid}").json()
    assert m["stages"]["1"]["rows"] == 2          # only MAZ kept
    assert c.get(f"/api/runs/{rid}/stages/1/preview",
                 params={"kind": "removed"}).json()["total"] == 2


def test_single_zone_requires_pick_before_stage1(tmp_path):
    c = client(tmp_path)
    rid = c.post("/api/runs?mode=single_zone", files={"file": dm_zoned()}).json()["run_id"]
    assert c.post(f"/api/runs/{rid}/advance").status_code == 409


# ---- Final output download (Stage 14 deliverables) ----
def test_final_file_download(tmp_path):
    c = client(tmp_path)
    rid = c.post("/api/runs", files={"file": dm_file()}).json()["run_id"]
    fin = tmp_path / "runs" / rid / "final"
    fin.mkdir(parents=True, exist_ok=True)
    (fin / "Final Userbase.xlsx").write_bytes(b"XLSXDATA")
    r = c.get(f"/api/runs/{rid}/final/Final Userbase.xlsx")
    assert r.status_code == 200 and r.content == b"XLSXDATA"
    assert c.get(f"/api/runs/{rid}/final/missing.xlsx").status_code == 404
    # basename-sanitised: traversal cannot escape final/
    assert c.get(f"/api/runs/{rid}/final/..%2f..%2fmanifest.json").status_code == 404


# ---- Appended users get OT + valid-email gate (checklist fix) ----
def test_append_defaults_ot_and_skips_invalid_emails():
    df = pd.DataFrame({
        config.EMAIL_COLUMN: ["have@x.y"],
        config.OT_COLUMN: ["No"],
        "Employee Name": ["Have"],
    })
    aur = pd.DataFrame({"E-MAIL": ["new@x.y", "noemail@x.y", "bad.email"],
                        "NAME": ["N1", "N2", "N3"]})
    res = aurora.run(df, aur)
    # only new@x.y appended; noemail + missing-@ skipped
    assert len(res.kept) == 2
    row = res.kept[res.kept[config.EMAIL_COLUMN] == "new@x.y"].iloc[0]
    assert row[config.OT_COLUMN] == "No"          # appended rows default OT=No
    assert row[config.AURORA_COLUMN] == "Yes"
