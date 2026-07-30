import pandas as pd
from engine import config, io_utils
from engine.stages import export_final


def test_export_writes_files_and_checklist(tmp_path):
    df = pd.DataFrame(
        {c: ["v"] for c in config.REQUIRED_COLUMNS}
        | {config.OT_COLUMN: ["No"], config.O365_COLUMN: [""],
           config.SAVIYNT_COLUMN: [""], config.ZONE_VALIDATION_COLUMN: [""],
           config.AURORA_COLUMN: ["No"], config.BSC_COLUMN: ["No"]}
    )
    df["Employee Email"] = ["ok@x.y"]
    removed = pd.DataFrame({"Employee Email": ["x@y.z"], "Removal Reason": ["r"], "Removal Stage": ["s"]})
    stats = {7: {"unvalidated_zones": ["SAZ"]}, 12: {"removed": 0}, 13: {"duplicates_removed": 0}}
    r = export_final.run(df, removed, stats, tmp_path)
    assert (tmp_path / "Final Userbase.xlsx").exists()
    assert (tmp_path / "Removed_Users_Report.xlsx").exists()
    assert (tmp_path / "Automation_Report.xlsx").exists()
    # Zone validation is Completed once Stage 7 ran; zones without a file (SAZ here)
    # are informational, not a checklist failure.
    zone_item = [c for c in r.stats["checklist"] if "Zone validation" in c["item"]][0]
    assert zone_item["status"] == "Completed"
    back = io_utils.read_table(tmp_path / "Removed_Users_Report.xlsx", "Removed Users")
    assert back["Employee Email"].tolist() == ["x@y.z"]
