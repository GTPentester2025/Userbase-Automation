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
