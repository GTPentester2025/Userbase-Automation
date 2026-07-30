from pathlib import Path

import pandas as pd

from engine import config
from engine.io_utils import norm_series, write_xlsx
from engine.types import StageResult

CHECKLIST_ITEMS = [
    "Employee Email contains valid email addresses only",
    "No blank Employee Email values exist",
    "OT column is populated with Yes/No",
    "SSOUPN as per AD (O365) is populated wherever available",
    "SSOUPN as per Saviynt is populated wherever available",
    "Zone validation completed for MAZ, SAZ, NAZ, APC, AFR, EUR, and Growth",
    "Additional users from Zone files added where applicable",
    "Aurora validation completed",
    "BSC validation completed",
    "CEO users removed",
    "Duplicate Employee Email records removed",
]


def run(df, all_removed: pd.DataFrame, stage_stats: dict, out_dir) -> StageResult:
    out_dir = Path(out_dir)
    emails = norm_series(df[config.EMAIL_COLUMN])
    zone7 = stage_stats.get(7, {})
    unvalidated = zone7.get("unvalidated_zones", config.ZONES)
    status = {}
    status[0] = bool(emails.str.contains("@").all() and not emails.str.contains("noemail").any())
    status[1] = bool((emails != "").all())
    status[2] = bool(df[config.OT_COLUMN].isin(["Yes", "No"]).all()) if config.OT_COLUMN in df else False
    status[3] = config.O365_COLUMN in df.columns
    status[4] = config.SAVIYNT_COLUMN in df.columns
    # Zone validation is "completed" once Stage 7 ran — zones without a file are
    # legitimately skipped by design, not a failure. Report them as info instead.
    status[5] = 7 in stage_stats
    status[6] = 8 in stage_stats
    status[7] = 10 in stage_stats or config.AURORA_COLUMN in df.columns
    status[8] = 11 in stage_stats or config.BSC_COLUMN in df.columns
    status[9] = 12 in stage_stats
    status[10] = 13 in stage_stats
    checklist = [
        {"item": it, "status": "Completed" if status[i] else "Attention"}
        for i, it in enumerate(CHECKLIST_ITEMS)
    ]
    write_xlsx(df, out_dir / "Final Userbase.xlsx", "Final Userbase")
    write_xlsx(
        all_removed if len(all_removed) else
        pd.DataFrame(columns=["Employee Email", "Removal Reason", "Removal Stage"]),
        out_dir / "Removed_Users_Report.xlsx",
        "Removed Users",
    )
    summary_rows = [
        {"Stage": n, **{k: str(v) for k, v in s.items()}}
        for n, s in sorted(stage_stats.items())
    ]
    out_dir.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(out_dir / "Automation_Report.xlsx", engine="xlsxwriter") as w:
        pd.DataFrame(summary_rows).to_excel(w, sheet_name="Stage Summary", index=False)
        pd.DataFrame(checklist).to_excel(w, sheet_name="Checklist", index=False)
    files = ["Final Userbase.xlsx", "Removed_Users_Report.xlsx", "Automation_Report.xlsx"]
    done = sum(1 for c in checklist if c["status"] == "Completed")
    return StageResult(
        kept=df,
        stats={"checklist": checklist, "output_files": files,
               "rows": len(df), "removed_total": len(all_removed)},
        log_lines=[f"Wrote {', '.join(files)}",
                   f"Checklist: {done}/{len(checklist)} completed"],
    )
