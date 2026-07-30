"""Deterministic dummy input generator for manual UI testing and the e2e test."""
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine import config  # noqa: E402


def _email(i):
    if i <= 5:
        return ""
    if i <= 8:
        return f"noemail.user{i:03d}@abi.com"
    if i <= 10:
        return f"user{i:03d}.abi.com"  # missing @
    if i <= 14:
        return "dup@abi.com"
    return f"user{i:03d}@abi.com"


def _zone(i):
    return {0: "MAZ", 1: "SAZ"}.get(i % 3, "Other")


def build(out_dir) -> dict:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    n = 60
    rows = []
    for i in range(1, n + 1):
        r = {c: f"{c[:3]}{i}" for c in config.REQUIRED_COLUMNS}
        r["Zone"] = _zone(i)
        r["Employee Email"] = _email(i)
        r["Employee Name"] = f"User {i:03d}"
        if i in (15, 16, 17):
            r["Job Family Group"] = "SUPPLY"
            r["Job Family"] = "Plant Management"
            r["Job Profile Description"] = "Brewery Plant Manager"
        else:
            r["Job Family Group"] = "SALES"
            r["Job Family"] = "Commercial"
            r["Job Profile Description"] = "Sales Rep"
        rows.append(r)
    dm = pd.DataFrame(rows)
    dm["Extra Junk Column"] = "junk"
    files = {}

    p = out_dir / "datamart.xlsx"
    dm.to_excel(p, index=False)
    files["datamart"] = p

    valid = dm[(dm["Employee Email"].str.contains("@"))
               & (~dm["Employee Email"].str.contains("noemail"))]

    maz_emails = valid[valid["Zone"] == "MAZ"]["Employee Email"].drop_duplicates().tolist()
    maz_actions = ["Terminate" if e == maz_emails[-1] else "OK" for e in maz_emails]
    p = out_dir / "zone_MAZ.xlsx"
    with pd.ExcelWriter(p) as w:
        pd.DataFrame({"Employee Email": maz_emails, "Action": maz_actions}).to_excel(
            w, sheet_name="MAZ", index=False)
        pd.DataFrame({
            "Employee Email": ["maz.add1@abi.com", "maz.add2@abi.com"],
            "Employee Name": ["MAZ Add One", "MAZ Add Two"],
            "Zone": ["MAZ", "MAZ"],
        }).to_excel(w, sheet_name="add to the list", index=False)
    files["zone_MAZ"] = p

    saz_emails = valid[valid["Zone"] == "SAZ"]["Employee Email"].drop_duplicates().tolist()
    p = out_dir / "zone_SAZ.xlsx"
    pd.DataFrame({"Employee Email": saz_emails, "Action": ["OK"] * len(saz_emails)}).to_excel(
        p, sheet_name="SAZ", index=False)
    files["zone_SAZ"] = p

    o365_rows = [(e, f"upn{i}@ad.abi.com")
                 for i, e in enumerate(valid["Employee Email"].drop_duplicates(), 1)
                 if i % 2 == 0]
    p = out_dir / "o365.xlsx"
    pd.DataFrame(o365_rows, columns=["Mail", "UserPrincipalName"]).to_excel(p, index=False)
    files["o365"] = p

    sav_rows = [(e, f"sso{i}@abi.com")
                for i, e in enumerate(valid["Employee Email"].drop_duplicates(), 1)
                if i % 3 == 0]
    p = out_dir / "saviynt.xlsx"
    pd.DataFrame(sav_rows, columns=["User Email", "SSO UPN"]).to_excel(p, index=False)
    files["saviynt"] = p

    some = valid["Employee Email"].drop_duplicates().tolist()[:3]
    p = out_dir / "aurora.xlsx"
    pd.DataFrame({
        "E-MAIL": some + ["aurora.new1@abi.com", "aurora.new2@abi.com"],
        "NAME": [f"N{i}" for i in range(len(some))] + ["Aurora New1", "Aurora New2"],
    }).to_excel(p, sheet_name="Aurora Userbase", index=False)
    files["aurora"] = p

    p = out_dir / "bsc.xlsx"
    pd.DataFrame({"Email - Primary Work": some[:2] + ["bsc.new1@abi.com"]}).to_excel(
        p, sheet_name="main", index=False)
    files["bsc"] = p

    p = out_dir / "ceo.xlsx"
    with pd.ExcelWriter(p) as w:
        pd.DataFrame({"Mail ID": ["stale@abi.com"]}).to_excel(
            w, sheet_name="19 Feb 2026", index=False)
        pd.DataFrame({"Mail ID": ["user018@abi.com", "upn2@ad.abi.com"]}).to_excel(
            w, sheet_name="25 May 2026", index=False)
    files["ceo"] = p

    return files


if __name__ == "__main__":
    out = build(Path(__file__).resolve().parent.parent / "input_dummy")
    for slot, path in out.items():
        print(f"{slot}: {path}")
