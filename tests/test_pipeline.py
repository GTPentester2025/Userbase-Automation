import io

import pandas as pd
import pytest
from engine import config, pipeline
from engine.store import RunStore


def dm_bytes():
    df = pd.DataFrame({c: ["v1", "v2"] for c in config.REQUIRED_COLUMNS})
    df["Employee Email"] = ["a@x.y", "b@x.y"]
    df["Zone"] = ["MAZ", "Other"]
    buf = io.BytesIO()
    df.to_excel(buf, index=False)
    return buf.getvalue()


def test_advance_through_no_input_stages(tmp_path):
    st = RunStore(tmp_path / "runs")
    rid = st.create_run()
    st.save_upload(rid, "datamart", "dm.xlsx", dm_bytes())
    for _ in range(4):  # stages 1-4
        pipeline.advance(st, rid)
    m = st.manifest(rid)
    assert m["frontier"] == 5 and m["stages"]["4"]["status"] == "done"


def test_advance_blocks_on_missing_input(tmp_path):
    st = RunStore(tmp_path / "runs")
    rid = st.create_run()
    st.save_upload(rid, "datamart", "dm.xlsx", dm_bytes())
    for _ in range(4):
        pipeline.advance(st, rid)
    with pytest.raises(pipeline.PipelineError, match="o365"):
        pipeline.advance(st, rid)


def test_missing_inputs_lists_slots(tmp_path):
    st = RunStore(tmp_path / "runs")
    rid = st.create_run()
    assert pipeline.missing_inputs(st, rid, 1) == ["datamart"]
    assert pipeline.missing_inputs(st, rid, 7) == []
