import pandas as pd
from engine.store import RunStore
from engine.types import StageResult


def make(tmp_path):
    return RunStore(tmp_path / "runs")


def test_create_and_manifest(tmp_path):
    st = make(tmp_path)
    rid = st.create_run()
    m = st.manifest(rid)
    assert m["status"] == "idle" and m["frontier"] == 1 and m["inputs"]["datamart"] is None


def test_upload_and_stage_roundtrip(tmp_path):
    st = make(tmp_path)
    rid = st.create_run()
    st.save_upload(rid, "datamart", "dm.csv", b"Employee Email\na@b.c\n")
    df = pd.DataFrame({"Employee Email": ["a@b.c"]})
    rem = pd.DataFrame({"Employee Email": ["x@y.z"], "Removal Reason": ["r"], "Removal Stage": ["s"]})
    st.save_stage(rid, 3, "email_validation", StageResult(kept=df, removed=rem, stats={"n": 1}, log_lines=["l"]))
    m = st.manifest(rid)
    assert m["stages"]["3"]["rows"] == 1 and m["frontier"] == 4
    assert st.load_kept(rid, 5)["Employee Email"].tolist() == ["a@b.c"]
    assert st.load_frame(rid, 3, "removed")["Removal Reason"].tolist() == ["r"]
    p = st.download_path(rid, 3, "kept", "xlsx")
    assert p.exists() and p.suffix == ".xlsx"


def test_supersede(tmp_path):
    st = make(tmp_path)
    rid = st.create_run()
    df = pd.DataFrame({"Employee Email": ["a@b.c"]})
    st.save_stage(rid, 3, "email_validation", StageResult(kept=df))
    st.save_stage(rid, 4, "ot_filter", StageResult(kept=df))
    st.supersede(rid, 4)
    m = st.manifest(rid)
    assert "4" not in m["stages"] and "3" in m["stages"] and m["frontier"] == 4
    sup = list((st.base_dir / rid).glob("stage_04_*/superseded_*/kept.parquet"))
    assert len(sup) == 1
