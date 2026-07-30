# Userbase Automation Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Local web app that runs the 14-step Userbase Creation SOP on a Python/pandas backend with full audit storage (kept/removed/added per stage), stage-wise download/reupload, and a one-click launcher.

**Architecture:** FastAPI server serves a static single-page frontend and a REST API. A pure-function stage engine (one module per SOP stage) transforms pandas DataFrames; a RunStore persists every stage's kept/removed/added rows as parquet under `runs/run_<timestamp>/`, generating xlsx/csv only on download. Frontend is the metro-rail "Pipeline Studio" design from the reference project, rewritten against the API.

**Tech Stack:** Python 3.12+, FastAPI, uvicorn, pandas, pyarrow, openpyxl (read), xlsxwriter (write), python-multipart, pytest. Frontend: vanilla HTML/CSS/JS, no build step.

**Spec:** `docs/superpowers/specs/2026-07-30-userbase-automation-ui-design.md`. SOP text: `.firecrawl/sop.md`. Reference design: `C:\Users\GT\Documents\test_UAT\new\Userbase Automation\web\` (styles/layout only).

## Global Constraints

- SOP is the source of truth; where old Python code (`extracted/Userbase Automation For MAZ - Copy/`) disagrees, follow the SOP.
- All email matching: case-insensitive, trimmed (`norm_email`).
- Zones: `MAZ, SAZ, NAZ, APC, AFR, EUR, GHQ, Growth` — each zone file optional; missing file → that zone's rows pass through unvalidated and are flagged.
- Nothing under `runs/` is ever deleted or overwritten; replacements supersede into `superseded_<timestamp>/` subfolders.
- Stage snapshots are parquet; xlsx/csv generated on demand and cached.
- Server binds `127.0.0.1:8765`.
- Removed-row frames always carry `Removal Reason` and `Removal Stage` columns; added-row frames carry `Source`.
- The 21 SOP columns (exact, in order):
  `Zone, Country, Global Employee ID, Local Employee ID, Employee Name, Employee Status, Worker Type, Employee Group, Management Level, First Hire Date, Last Hire Date, Position Name, Job Family Group, Job Family, Job Profile Description, ABI Entity 2, Macro Entity Level 2 (Zone), Employee Email, Band 4+, Manager Employee ID Level 01, Manager Name Level 01`
- Working directory for all commands: repo root `C:\Users\GT\Downloads\Userbase-Automation-For-MAZ-main\Userbase-Automation-For-MAZ-main`.

## File Structure

```
server.py                  # FastAPI app + static serving (thin; routes only)
engine/
  __init__.py
  config.py                # SOP columns, OT lists, zones, input slots, stage table
  types.py                 # StageResult dataclass
  io_utils.py              # norm_email, read_table, find_additional_sheet, latest_dated_sheet, write_xlsx
  store.py                 # RunStore: run dirs, manifest, snapshots, supersede, downloads
  pipeline.py              # stage registry + advance/run-all + input requirements
  stages/
    __init__.py
    column_filter.py       # stage 1  (stage 2 = snapshot handled by pipeline)
    email_validation.py    # stage 3
    ot_filter.py           # stage 4
    ssoupn_o365.py         # stage 5
    ssoupn_saviynt.py      # stage 6
    zone_validation.py     # stage 7
    zone_additional.py     # stage 8  (stage 9 = summary, handled by pipeline)
    aurora.py              # stage 10
    bsc.py                 # stage 11
    ceo_exclusion.py       # stage 12
    dedupe.py              # stage 13
    export_final.py        # stage 14: checklist + xlsx reports
web/
  index.html
  styles.css               # copied from reference project, adapted
  app.js                   # rewritten against REST API
scripts/
  make_dummy_inputs.py     # generates input_dummy/*.xlsx for manual + e2e testing
tests/
  test_io_utils.py  test_stages_clean.py  test_stages_enrich.py
  test_stages_zone.py  test_stages_append.py  test_stages_final.py
  test_store.py  test_pipeline.py  test_server.py  test_e2e.py
requirements.txt
Start_App.bat
README.md
```

---

### Task 0: Scaffold + toolchain

**Files:**
- Create: `requirements.txt`, `.gitignore`, `engine/__init__.py`, `engine/stages/__init__.py`, `pytest.ini`

**Interfaces:**
- Produces: importable `engine` package; `.venv` with all deps; git repo.

- [ ] **Step 1: git init + gitignore**

```powershell
git init
```

`.gitignore`:
```
.venv/
__pycache__/
runs/
input_dummy/
.firecrawl/
extracted/
*.zip
```

- [ ] **Step 2: requirements + venv**

`requirements.txt`:
```
fastapi
uvicorn[standard]
pandas
pyarrow
openpyxl
xlsxwriter
python-multipart
pytest
httpx
```

```powershell
py -3.12 -m venv .venv; if ($?) { .venv\Scripts\pip install -r requirements.txt }
```
(If `py -3.12` missing, use `python -m venv .venv`.)

- [ ] **Step 3: package files**

Empty `engine/__init__.py`, `engine/stages/__init__.py`.

`pytest.ini`:
```ini
[pytest]
testpaths = tests
```

- [ ] **Step 4: verify + commit**

Run: `.venv\Scripts\python -c "import fastapi, pandas, pyarrow, xlsxwriter, openpyxl"` → no output, exit 0.

```powershell
git add -A; git commit -m "chore: scaffold project, deps, gitignore"
```

---

### Task 1: config, types, io_utils

**Files:**
- Create: `engine/config.py`, `engine/types.py`, `engine/io_utils.py`
- Test: `tests/test_io_utils.py`

**Interfaces:**
- Produces:
  - `config.REQUIRED_COLUMNS: list[str]` (21 SOP columns), `config.EMAIL_COLUMN = "Employee Email"`, `config.ZONES = ["MAZ","SAZ","NAZ","APC","AFR","EUR","GHQ","Growth"]`, `config.ZONE_VALIDATION_COLUMN = "Zone Validation"`, `config.OT_COLUMN = "OT (Yes/No)"`, `config.O365_COLUMN = "SSOUPN as per AD (O365)"`, `config.SAVIYNT_COLUMN = "SSOUPN as per Saviynt"`, `config.AURORA_COLUMN = "Aurora (Yes/No)"`, `config.BSC_COLUMN = "BSC (Yes/No)"`, `config.OT_JOB_FAMILY_GROUP = ["SUPPLY"]`, `config.OT_JOB_FAMILY = [...]`, `config.OT_JOB_PROFILES = [...31 profiles...]`, `config.INPUT_SLOTS: list[str]` = `["datamart","o365","saviynt","aurora","bsc","ceo"] + [f"zone_{z}" for z in ZONES]`
  - `types.StageResult(kept, removed=None, added=None, stats={}, log_lines=[])` dataclass
  - `io_utils.norm_email(v) -> str`; `io_utils.norm_series(s) -> pd.Series`
  - `io_utils.read_table(path, sheet_name=0) -> pd.DataFrame` (xlsx via openpyxl, csv via pandas; all cells as str, NaN→"")
  - `io_utils.find_additional_sheet(path) -> str | None` (sheet whose lowercase name contains "add")
  - `io_utils.latest_dated_sheet(path) -> str` (sheet names like "25 May 2026" → max date; fallback first sheet)
  - `io_utils.write_xlsx(df, path, sheet_name="Sheet1")` (xlsxwriter, autofilter, frozen header)

- [ ] **Step 1: Write failing tests**

`tests/test_io_utils.py`:
```python
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
        pd.DataFrame({"A": [1]}).to_excel(w, "MAZ", index=False)
        pd.DataFrame({"B": [2]}).to_excel(w, "add to the list", index=False)
    assert io_utils.read_table(p, "MAZ")["A"].tolist() == ["1"]
    assert io_utils.find_additional_sheet(p) == "add to the list"

def test_latest_dated_sheet(tmp_path):
    p = tmp_path / "ceo.xlsx"
    with pd.ExcelWriter(p) as w:
        pd.DataFrame({"Mail ID": ["a@b.c"]}).to_excel(w, "19 Feb 2026", index=False)
        pd.DataFrame({"Mail ID": ["d@e.f"]}).to_excel(w, "25 May 2026", index=False)
    assert io_utils.latest_dated_sheet(p) == "25 May 2026"

def test_write_xlsx_roundtrip(tmp_path):
    p = tmp_path / "out.xlsx"
    io_utils.write_xlsx(pd.DataFrame({"A": ["1"]}), p, "Final Output")
    assert io_utils.read_table(p, "Final Output")["A"].tolist() == ["1"]

def test_stage_result_defaults():
    r = StageResult(kept=pd.DataFrame())
    assert r.removed is None and r.added is None and r.stats == {} and r.log_lines == []
```

- [ ] **Step 2: Run, verify fail** — `.venv\Scripts\pytest tests/test_io_utils.py -q` → import errors.

- [ ] **Step 3: Implement**

`engine/types.py`:
```python
from dataclasses import dataclass, field
import pandas as pd

@dataclass
class StageResult:
    kept: pd.DataFrame
    removed: pd.DataFrame | None = None
    added: pd.DataFrame | None = None
    stats: dict = field(default_factory=dict)
    log_lines: list = field(default_factory=list)
```

`engine/config.py`: constants exactly as in Interfaces. `REQUIRED_COLUMNS` = the 21 columns from Global Constraints, in order. `OT_JOB_FAMILY = ["Engineering & Maintenance", "Plant Management"]`. `OT_JOB_PROFILES` = the 31 profiles copied verbatim from `extracted/Userbase Automation For MAZ - Copy/config.py` (`OT_JOB_PROFILE_DESCRIPTION_ALLOWED`).

`engine/io_utils.py`:
```python
import re
from datetime import datetime
from pathlib import Path
import pandas as pd

def norm_email(v) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    return str(v).strip().lower()

def norm_series(s: pd.Series) -> pd.Series:
    return s.fillna("").astype(str).str.strip().str.lower()

def read_table(path, sheet_name=0) -> pd.DataFrame:
    path = Path(path)
    if path.suffix.lower() == ".csv":
        df = pd.read_csv(path, dtype=str, keep_default_na=False)
    else:
        df = pd.read_excel(path, sheet_name=sheet_name, dtype=str, engine="openpyxl")
        df = df.fillna("")
    df.columns = [str(c).strip() for c in df.columns]
    return df

def _sheet_names(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True)
    try:
        return list(wb.sheetnames)
    finally:
        wb.close()

def find_additional_sheet(path):
    for name in _sheet_names(path):
        if "add" in name.lower():
            return name
    return None

def latest_dated_sheet(path) -> str:
    names = _sheet_names(path)
    dated = []
    for n in names:
        m = re.match(r"\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s*$", n)
        if m:
            try:
                dated.append((datetime.strptime(f"{m[1]} {m[2]} {m[3]}", "%d %B %Y"), n))
            except ValueError:
                pass
    return max(dated)[1] if dated else names[0]

def write_xlsx(df: pd.DataFrame, path, sheet_name="Sheet1"):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(path, engine="xlsxwriter") as w:
        df.to_excel(w, sheet_name=sheet_name, index=False)
        ws = w.sheets[sheet_name]
        if len(df.columns):
            ws.autofilter(0, 0, max(len(df), 1), len(df.columns) - 1)
            ws.freeze_panes(1, 0)
```

- [ ] **Step 4: Run, verify pass** — `.venv\Scripts\pytest tests/test_io_utils.py -q` → all pass.

- [ ] **Step 5: Commit** — `git add engine tests; git commit -m "feat: config, StageResult, io utils"`

---

### Task 2: cleaning stages — column_filter, email_validation, ot_filter, dedupe

**Files:**
- Create: `engine/stages/column_filter.py`, `engine/stages/email_validation.py`, `engine/stages/ot_filter.py`, `engine/stages/dedupe.py`
- Test: `tests/test_stages_clean.py`

**Interfaces:**
- Consumes: `config`, `types.StageResult`, `io_utils.norm_series`.
- Produces:
  - `column_filter.run(df) -> StageResult` — kept has exactly the REQUIRED_COLUMNS present in df (missing ones created empty, listed in `stats["missing_columns"]`; dropped listed in `stats["dropped_columns"]`).
  - `email_validation.run(df) -> StageResult` — removes blank / contains `noemail` / no `@`; removed rows tagged `Removal Reason` ∈ {"Blank Employee Email","Employee Email contains noemail","Employee Email missing @"}, `Removal Stage` = "Email Validation".
  - `ot_filter.run(df) -> StageResult` — adds `OT (Yes/No)`.
  - `dedupe.run(df) -> StageResult` — keep-first by normalized email; removed tagged `Removal Stage` = "Duplicate Removal".

- [ ] **Step 1: Write failing tests**

`tests/test_stages_clean.py`:
```python
import pandas as pd
from engine import config
from engine.stages import column_filter, email_validation, ot_filter, dedupe

def base_df(**over):
    d = {c: ["v"] for c in config.REQUIRED_COLUMNS}
    d["Employee Email"] = ["a@b.c"]
    d.update(over)
    return pd.DataFrame(d)

def test_column_filter_drops_and_fills():
    df = base_df()
    df["Junk"] = ["x"]
    df = df.drop(columns=["Band 4+"])
    r = column_filter.run(df)
    assert list(r.kept.columns) == config.REQUIRED_COLUMNS
    assert "Junk" in r.stats["dropped_columns"]
    assert "Band 4+" in r.stats["missing_columns"]
    assert r.kept["Band 4+"].tolist() == [""]

def test_email_validation():
    df = pd.DataFrame({"Employee Email": ["ok@x.y", "", "NOEMAIL@x.y", "bad.email", "  OK2@X.Y "]})
    r = email_validation.run(df)
    assert r.kept["Employee Email"].tolist() == ["ok@x.y", "  OK2@X.Y "]
    reasons = r.removed["Removal Reason"].tolist()
    assert reasons == ["Blank Employee Email", "Employee Email contains noemail", "Employee Email missing @"]
    assert set(r.removed["Removal Stage"]) == {"Email Validation"}

def test_ot_filter():
    df = pd.DataFrame({
        "Job Family Group": ["SUPPLY", "SUPPLY", "SALES"],
        "Job Family": ["Plant Management", "Plant Management", "Plant Management"],
        "Job Profile Description": ["Brewery Plant Manager", "Chef", "Brewery Plant Manager"],
    })
    r = ot_filter.run(df)
    assert r.kept[config.OT_COLUMN].tolist() == ["Yes", "No", "No"]
    assert r.stats["ot_yes"] == 1

def test_dedupe_keep_first():
    df = pd.DataFrame({"Employee Email": ["A@b.c", "x@y.z", " a@B.C "]})
    r = dedupe.run(df)
    assert r.kept["Employee Email"].tolist() == ["A@b.c", "x@y.z"]
    assert r.removed["Removal Stage"].tolist() == ["Duplicate Removal"]
```

- [ ] **Step 2: Run, verify fail** — `.venv\Scripts\pytest tests/test_stages_clean.py -q`

- [ ] **Step 3: Implement**

`engine/stages/column_filter.py`:
```python
from engine import config
from engine.types import StageResult

def run(df) -> StageResult:
    dropped = [c for c in df.columns if c not in config.REQUIRED_COLUMNS]
    missing = [c for c in config.REQUIRED_COLUMNS if c not in df.columns]
    kept = df.copy()
    for c in missing:
        kept[c] = ""
    kept = kept[config.REQUIRED_COLUMNS]
    return StageResult(
        kept=kept,
        stats={"dropped_columns": dropped, "missing_columns": missing,
               "rows": len(kept), "columns": len(kept.columns)},
        log_lines=[f"Kept {len(config.REQUIRED_COLUMNS)} required columns; "
                   f"dropped {len(dropped)}; missing (created blank): {len(missing)}"],
    )
```

`engine/stages/email_validation.py`:
```python
from engine import config
from engine.types import StageResult
from engine.io_utils import norm_series

def run(df) -> StageResult:
    emails = norm_series(df[config.EMAIL_COLUMN])
    blank = emails == ""
    noemail = ~blank & emails.str.contains("noemail")
    no_at = ~blank & ~noemail & ~emails.str.contains("@")
    removed = df[blank | noemail | no_at].copy()
    removed["Removal Reason"] = ""
    removed.loc[blank[blank | noemail | no_at], "Removal Reason"] = "Blank Employee Email"
    removed.loc[noemail[blank | noemail | no_at], "Removal Reason"] = "Employee Email contains noemail"
    removed.loc[no_at[blank | noemail | no_at], "Removal Reason"] = "Employee Email missing @"
    removed["Removal Stage"] = "Email Validation"
    kept = df[~(blank | noemail | no_at)].copy()
    stats = {"removed_blank": int(blank.sum()), "removed_noemail": int(noemail.sum()),
             "removed_no_at": int(no_at.sum()), "rows": len(kept)}
    return StageResult(kept=kept, removed=removed, stats=stats,
        log_lines=[f"Removed {len(removed)} rows "
                   f"(blank {stats['removed_blank']}, noemail {stats['removed_noemail']}, no-@ {stats['removed_no_at']})"])
```

`engine/stages/ot_filter.py`:
```python
from engine import config
from engine.types import StageResult

def run(df) -> StageResult:
    kept = df.copy()
    ok = (
        kept["Job Family Group"].str.strip().str.upper().isin([v.upper() for v in config.OT_JOB_FAMILY_GROUP])
        & kept["Job Family"].str.strip().isin(config.OT_JOB_FAMILY)
        & kept["Job Profile Description"].str.strip().isin(config.OT_JOB_PROFILES)
    )
    kept[config.OT_COLUMN] = ok.map({True: "Yes", False: "No"})
    return StageResult(kept=kept, stats={"ot_yes": int(ok.sum()), "rows": len(kept)},
                       log_lines=[f"OT = Yes for {int(ok.sum())} of {len(kept)} rows"])
```

`engine/stages/dedupe.py`:
```python
from engine import config
from engine.types import StageResult
from engine.io_utils import norm_series

def run(df) -> StageResult:
    dup = norm_series(df[config.EMAIL_COLUMN]).duplicated(keep="first")
    removed = df[dup].copy()
    removed["Removal Reason"] = "Duplicate Employee Email; first occurrence retained"
    removed["Removal Stage"] = "Duplicate Removal"
    kept = df[~dup].copy()
    return StageResult(kept=kept, removed=removed,
                       stats={"duplicates_removed": int(dup.sum()), "rows": len(kept)},
                       log_lines=[f"Removed {int(dup.sum())} duplicate email rows"])
```

- [ ] **Step 4: Run, verify pass** — `.venv\Scripts\pytest tests/test_stages_clean.py -q`
- [ ] **Step 5: Commit** — `git add -A; git commit -m "feat: cleaning stages (column filter, email validation, OT, dedupe)"`

---

### Task 3: enrichment stages — ssoupn_o365, ssoupn_saviynt

**Files:**
- Create: `engine/stages/ssoupn_o365.py`, `engine/stages/ssoupn_saviynt.py`
- Test: `tests/test_stages_enrich.py`

**Interfaces:**
- Produces:
  - `ssoupn_o365.run(df, o365_df) -> StageResult` — maps `Employee Email` (normalized) → O365 `Mail`, writes `UserPrincipalName` into `SSOUPN as per AD (O365)`; blank when unmatched. Raises `ValueError("O365 file missing required column: <name>")` on absent `Mail`/`UserPrincipalName`.
  - `ssoupn_saviynt.run(df, saviynt_df) -> StageResult` — same pattern with `User Email` / `SSO UPN` → `SSOUPN as per Saviynt`.

- [ ] **Step 1: Write failing tests**

`tests/test_stages_enrich.py`:
```python
import pandas as pd
import pytest
from engine import config
from engine.stages import ssoupn_o365, ssoupn_saviynt

def test_o365_maps_and_blanks():
    df = pd.DataFrame({"Employee Email": ["A@b.c", "x@y.z"]})
    o365 = pd.DataFrame({"Mail": [" a@B.C "], "UserPrincipalName": ["a.upn@abi.com"]})
    r = ssoupn_o365.run(df, o365)
    assert r.kept[config.O365_COLUMN].tolist() == ["a.upn@abi.com", ""]
    assert r.stats["matched"] == 1

def test_o365_missing_column():
    with pytest.raises(ValueError, match="Mail"):
        ssoupn_o365.run(pd.DataFrame({"Employee Email": []}), pd.DataFrame({"X": []}))

def test_saviynt_maps():
    df = pd.DataFrame({"Employee Email": ["a@b.c"]})
    sav = pd.DataFrame({"User Email": ["a@b.c"], "SSO UPN": ["sso@abi.com"]})
    r = ssoupn_saviynt.run(df, sav)
    assert r.kept[config.SAVIYNT_COLUMN].tolist() == ["sso@abi.com"]
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

`engine/stages/ssoupn_o365.py`:
```python
from engine import config
from engine.types import StageResult
from engine.io_utils import norm_series

def _lookup(df, ref, key_col, val_col, out_col, label):
    for c in (key_col, val_col):
        if c not in ref.columns:
            raise ValueError(f"{label} file missing required column: {c}")
    mapping = dict(zip(norm_series(ref[key_col]), ref[val_col].fillna("").astype(str)))
    mapping.pop("", None)
    kept = df.copy()
    kept[out_col] = norm_series(kept[config.EMAIL_COLUMN]).map(mapping).fillna("")
    matched = int((kept[out_col] != "").sum())
    return StageResult(kept=kept, stats={"matched": matched, "rows": len(kept)},
                       log_lines=[f"{label}: matched {matched} of {len(kept)} rows"])

def run(df, o365_df) -> StageResult:
    return _lookup(df, o365_df, "Mail", "UserPrincipalName", config.O365_COLUMN, "O365")
```

`engine/stages/ssoupn_saviynt.py`:
```python
from engine import config
from engine.stages.ssoupn_o365 import _lookup

def run(df, saviynt_df):
    return _lookup(df, saviynt_df, "User Email", "SSO UPN", config.SAVIYNT_COLUMN, "Saviynt")
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -am "feat: SSOUPN enrichment stages (O365, Saviynt)"`

---

### Task 4: zone stages — zone_validation, zone_additional

**Files:**
- Create: `engine/stages/zone_validation.py`, `engine/stages/zone_additional.py`
- Test: `tests/test_stages_zone.py`

**Interfaces:**
- Consumes: zone frames provided by pipeline as `dict[str, pd.DataFrame]` keyed by zone code.
- Produces:
  - `zone_validation.run(df, zone_frames) -> StageResult` — for each zone Z in `config.ZONES` with a frame: rows where `Zone` (trimmed, case-insensitive) == Z are kept only if normalized email is in the zone frame's `Action == "OK"` email set; kept rows get `Zone Validation = f"{Z} Validated"`. Zones without frames: rows pass, `Zone Validation` stays `""`; recorded in `stats["unvalidated_zones"]`. Rows whose Zone is not in `config.ZONES` pass untouched. Removed reason: `f"Zone is {Z} but user not found with Action = OK"`, stage `"Zone Validation"`. Zone frame missing `Action` or `Employee Email` column → `ValueError(f"Zone {Z} file missing required column: <name>")`.
  - `zone_additional.run(df, additional_frames) -> StageResult` — `additional_frames: dict[str, pd.DataFrame]` (only zones whose file has an additional sheet). Appends rows whose normalized email is non-blank and absent from df; copies intersecting columns; sets `Zone Validation = f"{Z} Additional"`. `added` frame carries `Source = f"Zone {Z} additional tab"`. `stats["appended_per_zone"]`.

- [ ] **Step 1: Write failing tests**

`tests/test_stages_zone.py`:
```python
import pandas as pd
import pytest
from engine import config
from engine.stages import zone_validation, zone_additional

def udf(rows):
    d = {c: ["" for _ in rows] for c in config.REQUIRED_COLUMNS}
    d["Zone"] = [r[0] for r in rows]
    d["Employee Email"] = [r[1] for r in rows]
    df = pd.DataFrame(d)
    df[config.ZONE_VALIDATION_COLUMN] = ""
    return df

def test_zone_validation_keep_remove_pass():
    df = udf([("MAZ", "ok@x.y"), ("MAZ", "bad@x.y"), ("maz ", "notfound@x.y"),
              ("SAZ", "s@x.y"), ("Other", "o@x.y")])
    maz = pd.DataFrame({"Employee Email": [" OK@X.Y ", "bad@x.y"], "Action": ["OK", "Terminate"]})
    r = zone_validation.run(df, {"MAZ": maz})
    assert r.kept["Employee Email"].tolist() == ["ok@x.y", "s@x.y", "o@x.y"]
    assert r.kept[config.ZONE_VALIDATION_COLUMN].tolist() == ["MAZ Validated", "", ""]
    assert sorted(r.removed["Employee Email"]) == ["bad@x.y", "notfound@x.y"]
    assert "SAZ" in r.stats["unvalidated_zones"]

def test_zone_validation_missing_action():
    with pytest.raises(ValueError, match="Action"):
        zone_validation.run(udf([("MAZ", "a@b.c")]), {"MAZ": pd.DataFrame({"Employee Email": []})})

def test_zone_additional_appends_missing_only():
    df = udf([("MAZ", "have@x.y")])
    add = pd.DataFrame({"Employee Email": ["have@x.y", "new@x.y", ""],
                        "Employee Name": ["H", "N", "Z"], "Junk": ["j", "j", "j"]})
    r = zone_additional.run(df, {"MAZ": add})
    assert len(r.kept) == 2
    new = r.kept.iloc[1]
    assert new["Employee Email"] == "new@x.y" and new["Employee Name"] == "N"
    assert new[config.ZONE_VALIDATION_COLUMN] == "MAZ Additional"
    assert "Junk" not in r.kept.columns
    assert r.added["Source"].tolist() == ["Zone MAZ additional tab"]
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

`engine/stages/zone_validation.py`:
```python
from engine import config
from engine.types import StageResult
from engine.io_utils import norm_series
import pandas as pd

def run(df, zone_frames: dict) -> StageResult:
    kept = df.copy()
    if config.ZONE_VALIDATION_COLUMN not in kept.columns:
        kept[config.ZONE_VALIDATION_COLUMN] = ""
    zone_norm = kept["Zone"].fillna("").astype(str).str.strip().str.upper()
    emails = norm_series(kept[config.EMAIL_COLUMN])
    remove_mask = pd.Series(False, index=kept.index)
    reasons = pd.Series("", index=kept.index)
    unvalidated, logs, per_zone = [], [], {}
    for z in config.ZONES:
        in_zone = zone_norm == z.upper()
        if z not in zone_frames:
            if int(in_zone.sum()):
                unvalidated.append(z)
                logs.append(f"{z}: no file uploaded — {int(in_zone.sum())} rows pass unvalidated")
            continue
        zf = zone_frames[z]
        for c in (config.EMAIL_COLUMN, "Action"):
            if c not in zf.columns:
                raise ValueError(f"Zone {z} file missing required column: {c}")
        ok = set(norm_series(zf[config.EMAIL_COLUMN])[
            zf["Action"].fillna("").astype(str).str.strip().str.upper() == "OK"]) - {""}
        good = in_zone & emails.isin(ok)
        bad = in_zone & ~emails.isin(ok)
        kept.loc[good, config.ZONE_VALIDATION_COLUMN] = f"{z} Validated"
        remove_mask |= bad
        reasons[bad] = f"Zone is {z} but user not found with Action = OK"
        per_zone[z] = {"validated": int(good.sum()), "removed": int(bad.sum())}
        logs.append(f"{z}: validated {int(good.sum())}, removed {int(bad.sum())}")
    removed = kept[remove_mask].copy()
    removed["Removal Reason"] = reasons[remove_mask]
    removed["Removal Stage"] = "Zone Validation"
    kept = kept[~remove_mask]
    return StageResult(kept=kept, removed=removed,
        stats={"per_zone": per_zone, "unvalidated_zones": unvalidated, "rows": len(kept)},
        log_lines=logs)
```

`engine/stages/zone_additional.py`:
```python
from engine import config
from engine.types import StageResult
from engine.io_utils import norm_series, norm_email
import pandas as pd

def run(df, additional_frames: dict) -> StageResult:
    kept = df.copy()
    added_parts, logs, per_zone = [], [], {}
    have = set(norm_series(kept[config.EMAIL_COLUMN])) - {""}
    for z, af in additional_frames.items():
        if config.EMAIL_COLUMN not in af.columns:
            raise ValueError(f"Zone {z} additional tab missing required column: {config.EMAIL_COLUMN}")
        rows = []
        for _, row in af.iterrows():
            em = norm_email(row[config.EMAIL_COLUMN])
            if not em or em in have:
                continue
            have.add(em)
            new = {c: "" for c in kept.columns}
            for c in kept.columns:
                if c in af.columns:
                    new[c] = str(row[c]) if pd.notna(row[c]) else ""
            new[config.ZONE_VALIDATION_COLUMN] = f"{z} Additional"
            rows.append(new)
        per_zone[z] = len(rows)
        logs.append(f"{z}: appended {len(rows)} additional users")
        if rows:
            part = pd.DataFrame(rows)
            kept = pd.concat([kept, part], ignore_index=True)
            part = part.copy()
            part["Source"] = f"Zone {z} additional tab"
            added_parts.append(part)
    added = pd.concat(added_parts, ignore_index=True) if added_parts else None
    return StageResult(kept=kept, added=added,
        stats={"appended_per_zone": per_zone, "rows": len(kept)}, log_lines=logs)
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -am "feat: zone validation + additional append stages"`

---

### Task 5: append stages — aurora, bsc; removal stage — ceo_exclusion

**Files:**
- Create: `engine/stages/aurora.py`, `engine/stages/bsc.py`, `engine/stages/ceo_exclusion.py`
- Test: `tests/test_stages_append.py`

**Interfaces:**
- Produces:
  - `aurora.run(df, aurora_df) -> StageResult` — adds `Aurora (Yes/No)` by membership of normalized email in Aurora `E-MAIL`; appends Aurora rows not present in df (alias map `E-MAIL`→`Employee Email`, `NAME`→`Employee Name`, plus exact-name matching columns), Aurora=Yes, `Source="Aurora reverse lookup"`. Missing `E-MAIL` column → ValueError.
  - `bsc.run(df, bsc_df) -> StageResult` — same with `Email - Primary Work` → `Employee Email`, `Source="BSC reverse lookup"`.
  - `ceo_exclusion.run(df, ceo_df) -> StageResult` — remove rows where normalized `Employee Email` OR `SSOUPN as per AD (O365)` OR `SSOUPN as per Saviynt` is in CEO `Mail ID` set. Reason "Matched CEO Mail ID", stage "CEO Exclusion". Missing `Mail ID` → ValueError. (Pipeline selects the latest dated sheet before calling.)

- [ ] **Step 1: Write failing tests**

`tests/test_stages_append.py`:
```python
import pandas as pd
from engine import config
from engine.stages import aurora, bsc, ceo_exclusion

def udf(emails, **cols):
    d = {c: ["" for _ in emails] for c in config.REQUIRED_COLUMNS}
    d["Employee Email"] = emails
    d.update(cols)
    df = pd.DataFrame(d)
    for c in (config.ZONE_VALIDATION_COLUMN, config.O365_COLUMN, config.SAVIYNT_COLUMN):
        df[c] = cols.get(c, ["" for _ in emails])
    return df

def test_aurora_flags_and_appends():
    df = udf(["in@x.y", "out@x.y"])
    au = pd.DataFrame({"E-MAIL": [" IN@X.Y ", "new@x.y"], "NAME": ["In", "New"]})
    r = aurora.run(df, au)
    assert r.kept[config.AURORA_COLUMN].tolist() == ["Yes", "No", "Yes"]
    assert r.kept["Employee Email"].tolist()[-1] == "new@x.y"
    assert r.kept["Employee Name"].tolist()[-1] == "New"
    assert r.added["Source"].tolist() == ["Aurora reverse lookup"]

def test_bsc_flags_and_appends():
    df = udf(["in@x.y"])
    b = pd.DataFrame({"Email - Primary Work": ["in@x.y", "nb@x.y"]})
    r = bsc.run(df, b)
    assert r.kept[config.BSC_COLUMN].tolist() == ["Yes", "Yes"]
    assert r.kept["Employee Email"].tolist()[-1] == "nb@x.y"

def test_ceo_removes_on_any_field():
    df = udf(["a@x.y", "b@x.y", "c@x.y", "d@x.y"])
    df[config.O365_COLUMN] = ["", "hit2@x.y", "", ""]
    df[config.SAVIYNT_COLUMN] = ["", "", "hit3@x.y", ""]
    ceo = pd.DataFrame({"Mail ID": ["A@X.Y", "hit2@x.y", "HIT3@x.y"]})
    r = ceo_exclusion.run(df, ceo)
    assert r.kept["Employee Email"].tolist() == ["d@x.y"]
    assert len(r.removed) == 3
    assert set(r.removed["Removal Stage"]) == {"CEO Exclusion"}
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

`engine/stages/aurora.py`:
```python
from engine import config
from engine.types import StageResult
from engine.io_utils import norm_series, norm_email
import pandas as pd

def _flag_and_append(df, ref, email_col, flag_col, alias_map, source, label):
    if email_col not in ref.columns:
        raise ValueError(f"{label} file missing required column: {email_col}")
    kept = df.copy()
    ref_emails = norm_series(ref[email_col])
    have = set(norm_series(kept[config.EMAIL_COLUMN])) - {""}
    kept[flag_col] = norm_series(kept[config.EMAIL_COLUMN]).isin(set(ref_emails) - {""}).map({True: "Yes", False: "No"})
    rows = []
    for i, row in ref.iterrows():
        em = norm_email(row[email_col])
        if not em or em in have:
            continue
        have.add(em)
        new = {c: "" for c in kept.columns}
        for src, dst in alias_map.items():
            if src in ref.columns:
                new[dst] = str(row[src]) if pd.notna(row[src]) else ""
        for c in kept.columns:
            if c in ref.columns and c not in alias_map.values():
                new[c] = str(row[c]) if pd.notna(row[c]) else ""
        new[flag_col] = "Yes"
        rows.append(new)
    added = None
    if rows:
        added = pd.DataFrame(rows)
        kept = pd.concat([kept, added], ignore_index=True)
        added = added.copy()
        added["Source"] = source
    yes = int((kept[flag_col] == "Yes").sum())
    return StageResult(kept=kept, added=added,
        stats={"flag_yes": yes, "appended": len(rows), "rows": len(kept)},
        log_lines=[f"{label}: {yes} flagged Yes; appended {len(rows)} not-found users"])

def run(df, aurora_df) -> StageResult:
    return _flag_and_append(df, aurora_df, "E-MAIL", config.AURORA_COLUMN,
        {"E-MAIL": config.EMAIL_COLUMN, "NAME": "Employee Name"},
        "Aurora reverse lookup", "Aurora")
```

`engine/stages/bsc.py`:
```python
from engine import config
from engine.stages.aurora import _flag_and_append

def run(df, bsc_df):
    return _flag_and_append(df, bsc_df, "Email - Primary Work", config.BSC_COLUMN,
        {"Email - Primary Work": config.EMAIL_COLUMN},
        "BSC reverse lookup", "BSC")
```

`engine/stages/ceo_exclusion.py`:
```python
from engine import config
from engine.types import StageResult
from engine.io_utils import norm_series

def run(df, ceo_df) -> StageResult:
    if "Mail ID" not in ceo_df.columns:
        raise ValueError("CEO file missing required column: Mail ID")
    ceo = set(norm_series(ceo_df["Mail ID"])) - {""}
    mask = (norm_series(df[config.EMAIL_COLUMN]).isin(ceo)
            | norm_series(df[config.O365_COLUMN]).isin(ceo)
            | norm_series(df[config.SAVIYNT_COLUMN]).isin(ceo))
    removed = df[mask].copy()
    removed["Removal Reason"] = "Matched CEO Mail ID"
    removed["Removal Stage"] = "CEO Exclusion"
    return StageResult(kept=df[~mask].copy(), removed=removed,
        stats={"removed": int(mask.sum()), "rows": int((~mask).sum())},
        log_lines=[f"Removed {int(mask.sum())} CEO-matched users"])
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -am "feat: aurora/bsc append stages, CEO exclusion"`

---

### Task 6: export_final — checklist + reports

**Files:**
- Create: `engine/stages/export_final.py`
- Test: `tests/test_stages_final.py`

**Interfaces:**
- Consumes: full run context assembled by pipeline.
- Produces: `export_final.run(df, all_removed, stage_stats, out_dir) -> StageResult` where
  - `all_removed: pd.DataFrame` (concat of every stage's removed rows, may be empty)
  - `stage_stats: dict[int, dict]` (stage number → stats saved in manifest)
  - Writes to `out_dir`: `Final Userbase.xlsx` (sheet "Final Userbase"), `Removed_Users_Report.xlsx` (sheet "Removed Users"), `Automation_Report.xlsx` (sheets "Stage Summary", "Checklist").
  - `stats["checklist"]` = list of `{"item": str, "status": "Completed"|"Attention"}` — the 11 SOP checklist items; "Attention" when e.g. `unvalidated_zones` non-empty (zone item) or a stage never ran.
  - `stats["output_files"]` = list of the three file names.

- [ ] **Step 1: Write failing test**

`tests/test_stages_final.py`:
```python
import pandas as pd
from engine import config, io_utils
from engine.stages import export_final

def test_export_writes_files_and_checklist(tmp_path):
    df = pd.DataFrame({c: ["v"] for c in config.REQUIRED_COLUMNS}
                      | {config.OT_COLUMN: ["No"], config.O365_COLUMN: [""],
                         config.SAVIYNT_COLUMN: [""], config.ZONE_VALIDATION_COLUMN: [""],
                         config.AURORA_COLUMN: ["No"], config.BSC_COLUMN: ["No"]})
    removed = pd.DataFrame({"Employee Email": ["x@y.z"], "Removal Reason": ["r"], "Removal Stage": ["s"]})
    stats = {7: {"unvalidated_zones": ["SAZ"]}, 12: {"removed": 0}, 13: {"duplicates_removed": 0}}
    r = export_final.run(df, removed, stats, tmp_path)
    assert (tmp_path / "Final Userbase.xlsx").exists()
    assert (tmp_path / "Removed_Users_Report.xlsx").exists()
    assert (tmp_path / "Automation_Report.xlsx").exists()
    zone_item = [c for c in r.stats["checklist"] if "Zone validation" in c["item"]][0]
    assert zone_item["status"] == "Attention"
    back = io_utils.read_table(tmp_path / "Removed_Users_Report.xlsx", "Removed Users")
    assert back["Employee Email"].tolist() == ["x@y.z"]
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

`engine/stages/export_final.py`:
```python
from pathlib import Path
import pandas as pd
from engine import config
from engine.types import StageResult
from engine.io_utils import write_xlsx, norm_series

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
    status[0] = emails.str.contains("@").all() and not emails.str.contains("noemail").any()
    status[1] = (emails != "").all()
    status[2] = df[config.OT_COLUMN].isin(["Yes", "No"]).all() if config.OT_COLUMN in df else False
    status[3] = config.O365_COLUMN in df.columns
    status[4] = config.SAVIYNT_COLUMN in df.columns
    status[5] = len(unvalidated) == 0
    status[6] = 8 in stage_stats
    status[7] = 10 in stage_stats or config.AURORA_COLUMN in df.columns
    status[8] = 11 in stage_stats or config.BSC_COLUMN in df.columns
    status[9] = 12 in stage_stats
    status[10] = 13 in stage_stats
    checklist = [{"item": it, "status": "Completed" if status[i] else "Attention"}
                 for i, it in enumerate(CHECKLIST_ITEMS)]
    write_xlsx(df, out_dir / "Final Userbase.xlsx", "Final Userbase")
    write_xlsx(all_removed if len(all_removed) else
               pd.DataFrame(columns=["Employee Email", "Removal Reason", "Removal Stage"]),
               out_dir / "Removed_Users_Report.xlsx", "Removed Users")
    summary_rows = [{"Stage": n, **{k: str(v) for k, v in s.items()}}
                    for n, s in sorted(stage_stats.items())]
    with pd.ExcelWriter(out_dir / "Automation_Report.xlsx", engine="xlsxwriter") as w:
        pd.DataFrame(summary_rows).to_excel(w, "Stage Summary", index=False)
        pd.DataFrame(checklist).to_excel(w, "Checklist", index=False)
    files = ["Final Userbase.xlsx", "Removed_Users_Report.xlsx", "Automation_Report.xlsx"]
    return StageResult(kept=df, stats={"checklist": checklist, "output_files": files,
                                       "rows": len(df), "removed_total": len(all_removed)},
        log_lines=[f"Wrote {', '.join(files)}",
                   f"Checklist: {sum(1 for c in checklist if c['status']=='Completed')}/{len(checklist)} completed"])
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -am "feat: final export with SOP checklist and reports"`

---

### Task 7: RunStore

**Files:**
- Create: `engine/store.py`
- Test: `tests/test_store.py`

**Interfaces:**
- Produces class `RunStore(base_dir: Path)`:
  - `create_run() -> str` — makes `runs/run_YYYY-MM-DD_HHMMSS[_n]/` with `uploads/`, writes initial manifest `{"run_id", "created", "status": "idle", "frontier": 1, "inputs": {slot: None for slot in config.INPUT_SLOTS}, "stages": {}, "error": None}`.
  - `list_runs() -> list[dict]` (manifest summaries, newest first); `manifest(run_id) -> dict`; `save_manifest(run_id, m)`.
  - `save_upload(run_id, slot, filename, data: bytes) -> str` — saves to `uploads/<timestamp>_<slot>_<filename>`, records path in manifest `inputs[slot]`, returns path. Unknown slot → `ValueError`.
  - `stage_dir(run_id, n, key) -> Path` — `stage_{n:02d}_{key}/`, created.
  - `save_stage(run_id, n, key, result: StageResult)` — writes `kept.parquet`, optional `removed.parquet`/`added.parquet`, `log.json` (`{"stats", "log_lines"}`); updates manifest `stages[str(n)] = {"status": "done", "key": key, "rows": len(kept), "removed": len(removed or []), "added": len(added or []), "stats", "log_lines"}` and `frontier = n + 1`.
  - `load_kept(run_id, upto_n) -> pd.DataFrame` — kept.parquet of the highest completed stage ≤ upto_n that has one.
  - `load_frame(run_id, n, kind) -> pd.DataFrame` — kind ∈ kept|removed|added; missing → empty frame.
  - `supersede(run_id, from_n)` — every `stage_NN_*` with NN ≥ from_n gets its files moved into `superseded_<timestamp>/` inside itself; manifest entries for those stages deleted; `frontier = from_n`.
  - `download_path(run_id, n, kind, fmt) -> Path` — converts parquet → xlsx/csv into the stage dir (cached by name `{kind}.{fmt}`).
  - All parquet IO via pandas + pyarrow, strings preserved.

- [ ] **Step 1: Write failing tests**

`tests/test_store.py`:
```python
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
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

`engine/store.py`:
```python
import json, shutil
from datetime import datetime
from pathlib import Path
import pandas as pd
from engine import config
from engine.types import StageResult

class RunStore:
    def __init__(self, base_dir):
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _mpath(self, run_id):
        return self.base_dir / run_id / "manifest.json"

    def create_run(self) -> str:
        stamp = datetime.now().strftime("run_%Y-%m-%d_%H%M%S")
        run_id, i = stamp, 1
        while (self.base_dir / run_id).exists():
            i += 1
            run_id = f"{stamp}_{i}"
        (self.base_dir / run_id / "uploads").mkdir(parents=True)
        m = {"run_id": run_id, "created": datetime.now().isoformat(), "status": "idle",
             "frontier": 1, "inputs": {s: None for s in config.INPUT_SLOTS},
             "stages": {}, "error": None}
        self.save_manifest(run_id, m)
        return run_id

    def manifest(self, run_id) -> dict:
        return json.loads(self._mpath(run_id).read_text(encoding="utf-8"))

    def save_manifest(self, run_id, m):
        self._mpath(run_id).write_text(json.dumps(m, indent=2), encoding="utf-8")

    def list_runs(self):
        out = []
        for p in sorted(self.base_dir.glob("run_*"), reverse=True):
            if (p / "manifest.json").exists():
                out.append(self.manifest(p.name))
        return out

    def save_upload(self, run_id, slot, filename, data: bytes) -> str:
        if slot not in config.INPUT_SLOTS:
            raise ValueError(f"Unknown input slot: {slot}")
        ts = datetime.now().strftime("%H%M%S")
        rel = f"uploads/{ts}_{slot}_{filename}"
        p = self.base_dir / run_id / rel
        p.write_bytes(data)
        m = self.manifest(run_id)
        m["inputs"][slot] = rel
        self.save_manifest(run_id, m)
        return str(p)

    def input_path(self, run_id, slot):
        rel = self.manifest(run_id)["inputs"].get(slot)
        return (self.base_dir / run_id / rel) if rel else None

    def stage_dir(self, run_id, n, key) -> Path:
        p = self.base_dir / run_id / f"stage_{n:02d}_{key}"
        p.mkdir(parents=True, exist_ok=True)
        return p

    def _find_stage_dir(self, run_id, n):
        hits = list((self.base_dir / run_id).glob(f"stage_{n:02d}_*"))
        return hits[0] if hits else None

    def save_stage(self, run_id, n, key, result: StageResult):
        d = self.stage_dir(run_id, n, key)
        result.kept.astype(str).to_parquet(d / "kept.parquet")
        if result.removed is not None:
            result.removed.astype(str).to_parquet(d / "removed.parquet")
        if result.added is not None:
            result.added.astype(str).to_parquet(d / "added.parquet")
        (d / "log.json").write_text(
            json.dumps({"stats": result.stats, "log_lines": result.log_lines}, indent=2, default=str),
            encoding="utf-8")
        m = self.manifest(run_id)
        m["stages"][str(n)] = {
            "status": "done", "key": key, "rows": len(result.kept),
            "removed": 0 if result.removed is None else len(result.removed),
            "added": 0 if result.added is None else len(result.added),
            "stats": json.loads(json.dumps(result.stats, default=str)),
            "log_lines": result.log_lines,
        }
        m["frontier"] = max(m["frontier"], n + 1)
        self.save_manifest(run_id, m)

    def load_kept(self, run_id, upto_n) -> pd.DataFrame:
        for n in range(upto_n, 0, -1):
            d = self._find_stage_dir(run_id, n)
            if d and (d / "kept.parquet").exists():
                return pd.read_parquet(d / "kept.parquet")
        raise FileNotFoundError("No completed stage snapshot found")

    def load_frame(self, run_id, n, kind) -> pd.DataFrame:
        d = self._find_stage_dir(run_id, n)
        f = d / f"{kind}.parquet" if d else None
        return pd.read_parquet(f) if f and f.exists() else pd.DataFrame()

    def supersede(self, run_id, from_n):
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        m = self.manifest(run_id)
        for n in [int(k) for k in list(m["stages"]) if int(k) >= from_n]:
            d = self._find_stage_dir(run_id, n)
            if d:
                sup = d / f"superseded_{ts}"
                sup.mkdir(exist_ok=True)
                for f in list(d.iterdir()):
                    if f.is_file():
                        shutil.move(str(f), str(sup / f.name))
            del m["stages"][str(n)]
        m["frontier"] = from_n
        m["error"] = None
        if m["status"] != "running":
            m["status"] = "idle"
        self.save_manifest(run_id, m)

    def download_path(self, run_id, n, kind, fmt) -> Path:
        d = self._find_stage_dir(run_id, n)
        if not d or not (d / f"{kind}.parquet").exists():
            raise FileNotFoundError(f"No {kind} data at stage {n}")
        out = d / f"{kind}.{fmt}"
        if not out.exists():
            df = pd.read_parquet(d / f"{kind}.parquet")
            if fmt == "csv":
                df.to_csv(out, index=False, encoding="utf-8-sig")
            else:
                from engine.io_utils import write_xlsx
                write_xlsx(df, out, kind.capitalize())
        return out
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -am "feat: RunStore persistence (parquet snapshots, supersede, downloads)"`

---

### Task 8: pipeline — stage registry + advance

**Files:**
- Create: `engine/pipeline.py`
- Test: `tests/test_pipeline.py`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `STAGES: list[Stage]` — `Stage(n, key, title, needs)` for all 14: `(1,"column_filter","Column Filter",["datamart"]) (2,"base_userbase","Base Userbase",[]) (3,"email_validation","Email Validation",[]) (4,"ot_filter","OT Filter",[]) (5,"ssoupn_o365","SSOUPN O365",["o365"]) (6,"ssoupn_saviynt","SSOUPN Saviynt",["saviynt"]) (7,"zone_validation","Zone Validation",[]) (8,"zone_additional","Zone Additional Append",[]) (9,"zone_summary","Zone Loop Summary",[]) (10,"aurora","Aurora Validation",["aurora"]) (11,"bsc","BSC Validation",["bsc"]) (12,"ceo_exclusion","CEO Exclusion",["ceo"]) (13,"dedupe","Duplicate Removal",[]) (14,"export_final","Final Validation & Export",[])`. Stage 7/8 `needs` are dynamic: at least one `zone_*` slot uploaded is NOT required (all optional) — they always run.
  - `missing_inputs(store, run_id, n) -> list[str]` — slots required by stage n not yet uploaded.
  - `run_stage(store, run_id, n) -> dict` — loads working df (`store.load_kept(run_id, n-1)` except stage 1 which reads the datamart upload), executes the stage, saves via `store.save_stage`, returns the manifest stage entry. Stage specifics:
    - 1: `read_table(datamart_path)` → `column_filter.run`.
    - 2: identity snapshot; log "Base Userbase created"; also ensures `Zone Validation` column exists (empty).
    - 7: builds `zone_frames` = `{z: read_table(path)}` for every uploaded `zone_{z}` (first sheet).
    - 8: builds `additional_frames` = `{z: read_table(path, sheet)}` where `sheet = find_additional_sheet(path)` is not None.
    - 9: no transform; stats = copy of stage 7 `per_zone` + stage 8 `appended_per_zone` + `unvalidated_zones`; kept snapshot not re-written (identity save).
    - 12: `read_table(ceo_path, latest_dated_sheet(ceo_path))`.
    - 14: `all_removed` = concat of `store.load_frame(run_id, n, "removed")` for all stages; `stage_stats` from manifest; `out_dir = runs/<id>/final/`.
  - `advance(store, run_id) -> dict` — runs the stage at `frontier`; raises `PipelineError(msg)` if inputs missing or frontier > 14.
  - `run_all(store, run_id) -> list[dict]` — advance until blocked (missing input) or done; returns entries.
  - On stage exception: manifest `status="error"`, `error={"stage": n, "message": str(e)}`, re-raise `PipelineError`. On success `status="idle"` (or `"complete"` after 14).
  - Appends every log line to `runs/<id>/run_log.txt` with timestamp + stage prefix.

- [ ] **Step 1: Write failing tests**

`tests/test_pipeline.py`:
```python
import pandas as pd
import pytest
from engine import config, pipeline
from engine.store import RunStore

def dm_bytes():
    df = pd.DataFrame({c: ["v1", "v2"] for c in config.REQUIRED_COLUMNS})
    df["Employee Email"] = ["a@x.y", "b@x.y"]
    df["Zone"] = ["MAZ", "Other"]
    import io
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
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

`engine/pipeline.py`:
```python
from dataclasses import dataclass
from datetime import datetime
import pandas as pd
from engine import config
from engine.types import StageResult
from engine.io_utils import read_table, find_additional_sheet, latest_dated_sheet
from engine.stages import (column_filter, email_validation, ot_filter, ssoupn_o365,
                           ssoupn_saviynt, zone_validation, zone_additional, aurora,
                           bsc, ceo_exclusion, dedupe, export_final)

class PipelineError(Exception):
    pass

@dataclass
class Stage:
    n: int
    key: str
    title: str
    needs: list

STAGES = [
    Stage(1, "column_filter", "Column Filter", ["datamart"]),
    Stage(2, "base_userbase", "Base Userbase", []),
    Stage(3, "email_validation", "Email Validation", []),
    Stage(4, "ot_filter", "OT Filter", []),
    Stage(5, "ssoupn_o365", "SSOUPN O365", ["o365"]),
    Stage(6, "ssoupn_saviynt", "SSOUPN Saviynt", ["saviynt"]),
    Stage(7, "zone_validation", "Zone Validation", []),
    Stage(8, "zone_additional", "Zone Additional Append", []),
    Stage(9, "zone_summary", "Zone Loop Summary", []),
    Stage(10, "aurora", "Aurora Validation", ["aurora"]),
    Stage(11, "bsc", "BSC Validation", ["bsc"]),
    Stage(12, "ceo_exclusion", "CEO Exclusion", ["ceo"]),
    Stage(13, "dedupe", "Duplicate Removal", []),
    Stage(14, "export_final", "Final Validation & Export", []),
]
BY_N = {s.n: s for s in STAGES}

def missing_inputs(store, run_id, n):
    inputs = store.manifest(run_id)["inputs"]
    return [slot for slot in BY_N[n].needs if not inputs.get(slot)]

def _log(store, run_id, n, lines):
    p = store.base_dir / run_id / "run_log.txt"
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with p.open("a", encoding="utf-8") as f:
        for line in lines:
            f.write(f"[{ts}] [stage {n:02d}] {line}\n")

def _zone_frames(store, run_id, additional=False):
    frames = {}
    for z in config.ZONES:
        path = store.input_path(run_id, f"zone_{z}")
        if not path:
            continue
        if additional:
            sheet = find_additional_sheet(path)
            if sheet:
                frames[z] = read_table(path, sheet)
        else:
            frames[z] = read_table(path, 0)
    return frames

def _execute(store, run_id, stage) -> StageResult:
    n = stage.n
    if n == 1:
        return column_filter.run(read_table(store.input_path(run_id, "datamart"), 0))
    df = store.load_kept(run_id, n - 1)
    if n == 2:
        if config.ZONE_VALIDATION_COLUMN not in df.columns:
            df[config.ZONE_VALIDATION_COLUMN] = ""
        return StageResult(kept=df, stats={"rows": len(df)},
                           log_lines=["Base Userbase created — master file for the rest of the run"])
    if n == 3:
        return email_validation.run(df)
    if n == 4:
        return ot_filter.run(df)
    if n == 5:
        return ssoupn_o365.run(df, read_table(store.input_path(run_id, "o365"), 0))
    if n == 6:
        return ssoupn_saviynt.run(df, read_table(store.input_path(run_id, "saviynt"), 0))
    if n == 7:
        return zone_validation.run(df, _zone_frames(store, run_id))
    if n == 8:
        return zone_additional.run(df, _zone_frames(store, run_id, additional=True))
    if n == 9:
        m = store.manifest(run_id)
        s7 = m["stages"].get("7", {}).get("stats", {})
        s8 = m["stages"].get("8", {}).get("stats", {})
        stats = {"per_zone": s7.get("per_zone", {}),
                 "appended_per_zone": s8.get("appended_per_zone", {}),
                 "unvalidated_zones": s7.get("unvalidated_zones", [])}
        return StageResult(kept=df, stats=stats,
                           log_lines=[f"Zone loop complete; unvalidated zones: "
                                      f"{', '.join(stats['unvalidated_zones']) or 'none'}"])
    if n == 10:
        return aurora.run(df, read_table(store.input_path(run_id, "aurora"), 0))
    if n == 11:
        return bsc.run(df, read_table(store.input_path(run_id, "bsc"), 0))
    if n == 12:
        path = store.input_path(run_id, "ceo")
        return ceo_exclusion.run(df, read_table(path, latest_dated_sheet(path)))
    if n == 13:
        return dedupe.run(df)
    if n == 14:
        m = store.manifest(run_id)
        removed_parts = [store.load_frame(run_id, k, "removed") for k in range(1, 14)]
        removed_parts = [r for r in removed_parts if len(r)]
        all_removed = pd.concat(removed_parts, ignore_index=True) if removed_parts else pd.DataFrame()
        stage_stats = {int(k): v.get("stats", {}) for k, v in m["stages"].items()}
        out_dir = store.base_dir / run_id / "final"
        return export_final.run(df, all_removed, stage_stats, out_dir)
    raise PipelineError(f"Unknown stage {n}")

def run_stage(store, run_id, n) -> dict:
    stage = BY_N.get(n)
    if not stage:
        raise PipelineError(f"No such stage: {n}")
    missing = missing_inputs(store, run_id, n)
    if missing:
        raise PipelineError(f"Stage {n} ({stage.title}) needs input(s): {', '.join(missing)}")
    m = store.manifest(run_id)
    m["status"], m["error"] = "running", None
    store.save_manifest(run_id, m)
    try:
        result = _execute(store, run_id, stage)
    except PipelineError:
        raise
    except Exception as e:
        m = store.manifest(run_id)
        m["status"] = "error"
        m["error"] = {"stage": n, "message": str(e)}
        store.save_manifest(run_id, m)
        raise PipelineError(str(e)) from e
    store.save_stage(run_id, n, stage.key, result)
    _log(store, run_id, n, result.log_lines or [f"{stage.title} done"])
    m = store.manifest(run_id)
    m["status"] = "complete" if n == 14 else "idle"
    store.save_manifest(run_id, m)
    return m["stages"][str(n)]

def advance(store, run_id) -> dict:
    frontier = store.manifest(run_id)["frontier"]
    if frontier > 14:
        raise PipelineError("Pipeline already complete")
    return run_stage(store, run_id, frontier)

def run_all(store, run_id):
    out = []
    while store.manifest(run_id)["frontier"] <= 14:
        frontier = store.manifest(run_id)["frontier"]
        if missing_inputs(store, run_id, frontier):
            break
        out.append(advance(store, run_id))
    return out
```

- [ ] **Step 4: Run, verify pass** — `.venv\Scripts\pytest tests/test_pipeline.py -q`
- [ ] **Step 5: Commit** — `git commit -am "feat: pipeline registry, advance/run-all, run log"`

---

### Task 9: FastAPI server

**Files:**
- Create: `server.py`
- Test: `tests/test_server.py`

**Interfaces:**
- Consumes: `RunStore`, `pipeline`.
- Produces HTTP API (all under `/api`), static frontend at `/`:
  - `POST /api/runs` (multipart `file` = datamart) → `{run_id, manifest}` (creates run + saves upload to slot `datamart`)
  - `GET /api/runs` → `[manifest...]`; `GET /api/runs/{rid}` → manifest + `{"stage_meta": [{n,key,title,needs,missing}...]}`
  - `POST /api/runs/{rid}/inputs/{slot}` (multipart `file`) → manifest
  - `POST /api/runs/{rid}/advance` → stage entry or 409 `{detail}` on PipelineError
  - `POST /api/runs/{rid}/run-all` → `{"completed": [entries], "blocked_on": [slots] | null}`
  - `GET /api/runs/{rid}/stages/{n}/preview?kind=kept&page=1&q=` → `{"columns", "rows", "total", "page", "pages"}` — 200 rows/page; `q` filters rows where any cell contains q (case-insensitive)
  - `GET /api/runs/{rid}/stages/{n}/download?kind=kept&fmt=xlsx` → FileResponse
  - `POST /api/runs/{rid}/stages/{n}/replace` (multipart `file`) → supersedes stages ≥ n, saves the file as that stage's `kept` snapshot under key `replaced`, sets frontier = n+1, returns manifest. (Replacement file read with `read_table`; row count logged.)
  - `GET /api/runs/{rid}/logs.zip` → zip of the whole run folder (excluding cached `.xlsx/.csv` conversions is NOT required — include everything)
  - Static: `app.mount("/", StaticFiles(directory="web", html=True))` (mounted after API routes).
  - Stage execution runs in a thread (`anyio.to_thread` via `def` endpoints — FastAPI runs sync endpoints in a worker thread; sufficient).
  - `RUNS_DIR` = `Path(__file__).parent / "runs"`; store singleton at module level; tests override via `create_app(runs_dir)` factory.

- [ ] **Step 1: Write failing tests**

`tests/test_server.py`:
```python
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
    buf = io.BytesIO(); df.to_csv(buf, index=False)
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
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

`server.py`:
```python
import io, zipfile
from pathlib import Path
from fastapi import FastAPI, UploadFile, HTTPException
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
        return [{"n": s.n, "key": s.key, "title": s.title, "needs": s.needs,
                 "missing": pipeline.missing_inputs(store, rid, s.n)}
                for s in pipeline.STAGES]

    @app.post("/api/runs")
    def create_run(file: UploadFile):
        rid = store.create_run()
        store.save_upload(rid, "datamart", file.filename, file.file.read())
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
            store.save_upload(rid, slot, file.filename, file.file.read())
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
            mask = df.apply(lambda col: col.astype(str).str.contains(q, case=False, na=False)).any(axis=1)
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
        data = file.file.read()
        path = store.save_upload(rid, "datamart" if n == 1 else config.INPUT_SLOTS[0], f"replacement_{file.filename}", data) \
            if False else None  # placeholder never taken; replacement stored below
        # store replacement in uploads without binding to an input slot
        from datetime import datetime
        ts = datetime.now().strftime("%H%M%S")
        p = store.base_dir / rid / "uploads" / f"{ts}_replacement_stage{n:02d}_{file.filename}"
        p.write_bytes(data)
        df = read_table(p, 0)
        store.supersede(rid, n)
        store.save_stage(rid, n, "replaced", StageResult(
            kept=df, stats={"rows": len(df), "source": "user replacement"},
            log_lines=[f"Working file replaced by user upload ({len(df)} rows); stages after {n} superseded"]))
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
        return StreamingResponse(buf, media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{rid}_logs.zip"'})

    web = Path(__file__).parent / "web"
    if web.exists():
        app.mount("/", StaticFiles(directory=web, html=True))
    return app

app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)
```

Note: delete the dead `path = ...` placeholder lines in `replace` during implementation — write the clean version (save bytes to `uploads/`, `read_table`, `supersede`, `save_stage`).

- [ ] **Step 4: Run, verify pass** — `.venv\Scripts\pytest tests/test_server.py -q`
- [ ] **Step 5: Commit** — `git commit -am "feat: FastAPI server (runs, advance, preview, download, replace, logs.zip)"`

---

### Task 10: dummy inputs + end-to-end test

**Files:**
- Create: `scripts/make_dummy_inputs.py`
- Test: `tests/test_e2e.py`

**Interfaces:**
- Produces: `make_dummy_inputs.build(out_dir) -> dict[str, Path]` returning slot→file map; CLI `python scripts/make_dummy_inputs.py` writes to `input_dummy/`. Files: datamart (60 rows: mixed zones incl. MAZ/SAZ/Other, 5 blank emails, 3 noemail, 2 missing-@, 4 dup emails, 3 OT-qualifying), `zone_MAZ.xlsx` (sheet1 with Action OK/Terminate + `add to the list` sheet with 2 new users), `zone_SAZ.xlsx` (validation only), `o365.xlsx` (Mail/UserPrincipalName for half), `saviynt.xlsx` (User Email/SSO UPN for a third), `aurora.xlsx` (E-MAIL/NAME with 2 not-in-userbase), `bsc.xlsx` (Email - Primary Work with 1 not-in-userbase), `ceo.xlsx` (two dated sheets "19 Feb 2026" and "25 May 2026"; latest contains 1 userbase email + 1 SSOUPN hit).

- [ ] **Step 1: Write generator** (deterministic — fixed seed / fixed literals, no randomness), with `if __name__ == "__main__": build(Path("input_dummy"))`.

- [ ] **Step 2: Write e2e test**

`tests/test_e2e.py`:
```python
from fastapi.testclient import TestClient
from scripts.make_dummy_inputs import build
from server import create_app

def test_full_pipeline(tmp_path):
    files = build(tmp_path / "inputs")
    c = TestClient(create_app(tmp_path / "runs"))
    rid = c.post("/api/runs", files={"file": ("dm.xlsx", files["datamart"].read_bytes())}).json()["run_id"]
    for slot in ["o365", "saviynt", "zone_MAZ", "zone_SAZ", "aurora", "bsc", "ceo"]:
        assert c.post(f"/api/runs/{rid}/inputs/{slot}",
                      files={"file": (f"{slot}.xlsx", files[slot].read_bytes())}).status_code == 200
    r = c.post(f"/api/runs/{rid}/run-all").json()
    assert r["blocked_on"] is None
    m = c.get(f"/api/runs/{rid}").json()
    assert m["status"] == "complete"
    # every removal accounted for: initial rows == final kept + total removed - total added
    s = m["stages"]
    initial = s["1"]["rows"]
    removed = sum(v["removed"] for v in s.values())
    added = sum(v["added"] for v in s.values())
    assert s["14"]["rows"] == initial - removed + added
    # final files exist
    r = c.get(f"/api/runs/{rid}/stages/14/download", params={"kind": "kept", "fmt": "xlsx"})
    assert r.status_code == 200
    assert c.get(f"/api/runs/{rid}/logs.zip").status_code == 200
```

- [ ] **Step 3: Run full suite** — `.venv\Scripts\pytest -q` → all pass. Fix any count mismatches by adjusting the generator's expectations (the invariant assert is the contract).
- [ ] **Step 4: Generate manual data** — `.venv\Scripts\python scripts/make_dummy_inputs.py` → `input_dummy/` populated.
- [ ] **Step 5: Commit** — `git commit -am "feat: dummy input generator + end-to-end pipeline test"`

---

### Task 11: Frontend

**Files:**
- Create: `web/index.html`, `web/styles.css`, `web/app.js`

**Interfaces:**
- Consumes: the REST API from Task 9 exactly as specified there.
- Produces: the complete UI. No frameworks, no build.

- [ ] **Step 1: Copy + adapt styles**

```powershell
Copy-Item "C:\Users\GT\Documents\test_UAT\new\Userbase Automation\web\styles.css" web\styles.css
```
Keep the theme (dark studio, gold accent, DM Sans/DM Serif Display/JetBrains Mono, metro rail, panel, toasts, busybar). Add classes used below if absent: `.dropzone`, `.dropzone.filled`, `.tabbar`, `.tab.active`, `.pager`, `.error-banner`, `.run-picker`.

- [ ] **Step 2: index.html**

Same skeleton as the reference (`topbar` with brand + progress pill `0 / 14` + Latest button; `.stage` grid with `nav.metro` (`#stations`) and `section.panel` (`#busybar`, `#panel`); `#toasts`), plus a home view container `#home` (new-run dropzone + past-runs list). Single `<script src="app.js">` — no vendor xlsx (server does all file work). Title: "Userbase Automation — Pipeline Studio".

- [ ] **Step 3: app.js**

Structure (implement fully):

```javascript
// ---- api client ----
const api = {
  runs: () => fetch('/api/runs').then(r => r.json()),
  run: id => fetch(`/api/runs/${id}`).then(r => r.json()),
  createRun: file => upload('/api/runs', file),
  uploadInput: (id, slot, file) => upload(`/api/runs/${id}/inputs/${slot}`, file),
  advance: id => post(`/api/runs/${id}/advance`),
  runAll: id => post(`/api/runs/${id}/run-all`),
  preview: (id, n, kind, page, q) =>
    fetch(`/api/runs/${id}/stages/${n}/preview?kind=${kind}&page=${page}&q=${encodeURIComponent(q || '')}`).then(r => r.json()),
  replace: (id, n, file) => upload(`/api/runs/${id}/stages/${n}/replace`, file),
  downloadUrl: (id, n, kind, fmt) => `/api/runs/${id}/stages/${n}/download?kind=${kind}&fmt=${fmt}`,
  logsUrl: id => `/api/runs/${id}/logs.zip`,
};
async function upload(url, file) {
  const fd = new FormData(); fd.append('file', file);
  const r = await fetch(url, { method: 'POST', body: fd });
  if (!r.ok) throw new Error((await r.json()).detail || r.statusText);
  return r.json();
}
async function post(url) {
  const r = await fetch(url, { method: 'POST' });
  if (!r.ok) throw new Error((await r.json()).detail || r.statusText);
  return r.json();
}

// ---- state ----
const state = { runId: null, manifest: null, viewStage: null, previewKind: 'kept', page: 1, q: '' };
```

Behavior to implement:
- **Home view:** big dropzone/file-input "Upload Datamart to start a new run" → `api.createRun` → open run. Below: past runs (`api.runs()`) with id, created, status, `n/14` — click to reopen.
- **refresh():** `api.run(state.runId)` → `state.manifest` → `renderRail()` + `renderPanel()`.
- **renderRail():** 14 stations from `manifest.stage_meta`; status from `manifest.stages[n]` (done → green check + `−removed`/`+added` badges), `manifest.error.stage === n` → red, `n === frontier` → active gold; completed stations clickable → `state.viewStage = n`. Progress pill = `completedCount / 14`. Gold rail fill proportional.
- **renderPanel():** for viewed stage (default = frontier): title + SOP description (hardcode a `DESCRIPTIONS` map, one paragraph per stage from the spec table); metrics row (rows, removed, added, columns from stage entry); log lines; **input dropzones** for `stage_meta.missing` slots plus, at stage 7, all 8 optional `zone_*` slots (filled ones show filename ✓); action buttons; preview.
- **Preview:** tab bar kept | removed | added (disabled when count 0) → `api.preview` → table (columns header + rows), pager (page x of y, prev/next), search box (debounced 300ms, resets page). Table region is the only scroll area.
- **Buttons:** Continue (`api.advance`, then refresh; on 409 show toast with message), Run All (`api.runAll`; if `blocked_on` toast "Waiting for: …"), Download current (link `downloadUrl(id, viewStage, 'kept', 'xlsx')`), Download removed / added (enabled per counts; xlsx), CSV variants in a small dropdown, Upload replacement (file input → confirm dialog "Stages after N will be superseded and re-run — continue?" → `api.replace` → refresh), Download logs.zip (after stage 14).
- **Busy state:** while any api call in flight, animate `#busybar`; disable action buttons.
- **Error banner:** `manifest.error` → red banner with stage + message atop panel.
- **"Latest" button:** `state.viewStage = null` (frontier).
- **Toasts:** small helper `toast(msg, kind)` appending to `#toasts`, auto-remove 4s.

- [ ] **Step 4: Manual smoke test**

```powershell
.venv\Scripts\python scripts/make_dummy_inputs.py
.venv\Scripts\python server.py
```
Open `http://127.0.0.1:8765/`. Walk dummy files through all 14 stages: verify rail states, badges, previews (kept/removed/added), downloads, replacement upload at stage 3 re-runs, logs.zip downloads, past-run reopen works. Fix what breaks.

- [ ] **Step 5: Commit** — `git add web; git commit -m "feat: Pipeline Studio frontend"`

---

### Task 12: Launcher + README + final verification

**Files:**
- Create: `Start_App.bat`, `README.md` (replace any stub)

- [ ] **Step 1: Start_App.bat**

```bat
@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    echo First run: creating Python environment...
    py -3 -m venv .venv || python -m venv .venv
    ".venv\Scripts\pip" install -r requirements.txt
)
".venv\Scripts\python" -c "import fastapi, pandas, pyarrow, xlsxwriter, openpyxl" 2>nul || ".venv\Scripts\pip" install -r requirements.txt
start "" "http://127.0.0.1:8765/"
".venv\Scripts\python" server.py
```

- [ ] **Step 2: README.md** — how to start (double-click `Start_App.bat` / manual `python server.py`), the 14 stages (one line each), input files table (slot → expected columns/sheets), `runs/` storage layout, download/replace workflow, how to run tests (`pytest`), dummy data (`python scripts/make_dummy_inputs.py`).

- [ ] **Step 3: Full verification**

```powershell
.venv\Scripts\pytest -q
```
All green. Then double-click `Start_App.bat` → browser opens → run dummy pipeline end-to-end once more.

- [ ] **Step 4: Commit** — `git add -A; git commit -m "feat: one-click launcher and README"`

---

## Self-Review Notes

- Spec coverage: stages 1–14 (Tasks 2–6, 8), storage + supersede + downloads (7), API incl. preview/replace/logs.zip (9), UI incl. checkpoint navigation/dropzones/past runs (11), launcher (12), tests incl. e2e invariant (10), dummy generator (10), error handling — missing columns raise ValueError → manifest error → red station + banner (Tasks 3/4/5, 8, 11).
- Type consistency: `StageResult` fields, `run(df, ...) -> StageResult` signatures, manifest keys (`frontier`, `stages[str(n)]`, `inputs[slot]`), API shapes match between Tasks 9–11.
- Known simplification: server `replace` code block contains a scratch placeholder line flagged for deletion — the clean behavior is specified in prose beside it.
