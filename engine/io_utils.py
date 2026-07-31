import re
from datetime import datetime
from pathlib import Path

import pandas as pd

# Excel reads dominate every stage's runtime. openpyxl is pure-Python and crawls
# on large Datamarts (≈150s for 200k rows); python-calamine is a Rust reader that
# does the same in seconds with byte-identical output. Pick it when available and
# fall back to openpyxl so the app still runs if the wheel is missing.
try:
    import python_calamine  # noqa: F401
    _XLSX_ENGINE = "calamine"
except ImportError:  # pragma: no cover - depends on the deployed environment
    _XLSX_ENGINE = "openpyxl"


def norm_email(v) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    return str(v).strip().lower()


def norm_series(s: pd.Series) -> pd.Series:
    return s.fillna("").astype(str).str.strip().str.lower()


def is_valid_email(v) -> bool:
    """SOP Step 3 rule: non-blank, contains '@', and not a 'noemail' address.
    Single source of truth shared by email validation and the append stages."""
    e = norm_email(v)
    return bool(e) and "@" in e and "noemail" not in e


def read_table(path, sheet_name=0) -> pd.DataFrame:
    path = Path(path)
    if path.suffix.lower() == ".csv":
        # CSV is ~5x faster to read than xlsx for large Datamarts (no shared-string
        # parse) — the recommended format for very large inputs.
        df = pd.read_csv(path, dtype=str, keep_default_na=False)
    else:
        # dtype=str keeps numeric IDs as-typed ("123", not "123.0") — a raw
        # calamine to_python() path is ~25% faster but renders ints as floats.
        df = pd.read_excel(path, sheet_name=sheet_name, dtype=str, engine=_XLSX_ENGINE)
        df = df.fillna("")
    df.columns = [str(c).strip() for c in df.columns]
    return df


def _sheet_names(path):
    if _XLSX_ENGINE == "calamine":
        return list(python_calamine.CalamineWorkbook.from_path(str(path)).sheet_names)
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
