import pandas as pd
from engine import io_utils, config
from engine.types import StageResult


def test_norm_email():
    assert io_utils.norm_email("  John.Doe@ABI.com ") == "john.doe@abi.com"
    assert io_utils.norm_email(None) == ""
    assert io_utils.norm_email(float("nan")) == ""


def test_norm_series():
    s = pd.Series([" A@B.C ", None])
    assert io_utils.norm_series(s).tolist() == ["a@b.c", ""]


def test_config_columns():
    assert len(config.REQUIRED_COLUMNS) == 21
    assert "Band 4+" in config.REQUIRED_COLUMNS
    assert "text before Email" not in config.REQUIRED_COLUMNS
    assert len(config.ZONES) == 8
    assert len(config.OT_JOB_PROFILES) == 31


def test_read_table_csv(tmp_path):
    p = tmp_path / "a.csv"
    p.write_text("Employee Email,Zone\nx@y.z,MAZ\n,\n")
    df = io_utils.read_table(p)
    assert df["Employee Email"].tolist() == ["x@y.z", ""]


def test_read_table_xlsx_and_sheets(tmp_path):
    p = tmp_path / "a.xlsx"
    with pd.ExcelWriter(p) as w:
        pd.DataFrame({"A": [1]}).to_excel(w, sheet_name="MAZ", index=False)
        pd.DataFrame({"B": [2]}).to_excel(w, sheet_name="add to the list", index=False)
    assert io_utils.read_table(p, "MAZ")["A"].tolist() == ["1"]
    assert io_utils.find_additional_sheet(p) == "add to the list"


def test_latest_dated_sheet(tmp_path):
    p = tmp_path / "ceo.xlsx"
    with pd.ExcelWriter(p) as w:
        pd.DataFrame({"Mail ID": ["a@b.c"]}).to_excel(w, sheet_name="19 Feb 2026", index=False)
        pd.DataFrame({"Mail ID": ["d@e.f"]}).to_excel(w, sheet_name="25 May 2026", index=False)
    assert io_utils.latest_dated_sheet(p) == "25 May 2026"


def test_write_xlsx_roundtrip(tmp_path):
    p = tmp_path / "out.xlsx"
    io_utils.write_xlsx(pd.DataFrame({"A": ["1"]}), p, "Final Output")
    assert io_utils.read_table(p, "Final Output")["A"].tolist() == ["1"]


def test_stage_result_defaults():
    r = StageResult(kept=pd.DataFrame())
    assert r.removed is None and r.added is None and r.stats == {} and r.log_lines == []

