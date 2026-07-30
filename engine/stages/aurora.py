import pandas as pd

from engine import config
from engine.io_utils import is_valid_email, norm_email, norm_series
from engine.types import StageResult


def _new_row(kept, ref, row, alias_map):
    """Build one appended row: blank template, filled from the ref file, with the
    OT column defaulted to 'No' so the final checklist stays clean (appends happen
    after the OT stage, so an unset OT would otherwise read as incomplete)."""
    new = {c: "" for c in kept.columns}
    for src, dst in alias_map.items():
        if src in ref.columns:
            new[dst] = str(row[src]) if pd.notna(row[src]) else ""
    for c in kept.columns:
        if c in ref.columns and c not in alias_map.values():
            new[c] = str(row[c]) if pd.notna(row[c]) else ""
    if config.OT_COLUMN in kept.columns and not new.get(config.OT_COLUMN):
        new[config.OT_COLUMN] = "No"
    return new


def _flag_and_append(df, ref, email_col, flag_col, alias_map, source, label):
    if email_col not in ref.columns:
        raise ValueError(f"{label} file missing required column: {email_col}")
    kept = df.copy()
    ref_emails = norm_series(ref[email_col])
    have = set(norm_series(kept[config.EMAIL_COLUMN])) - {""}
    kept[flag_col] = (
        norm_series(kept[config.EMAIL_COLUMN])
        .isin(set(ref_emails) - {""})
        .map({True: "Yes", False: "No"})
    )
    rows = []
    for _, row in ref.iterrows():
        em = norm_email(row[email_col])
        # Only append users with a valid email (SOP Step 3 rule) and not already
        # present — keeps "valid emails only / no blanks" true after appends.
        if em in have or not is_valid_email(row[email_col]):
            continue
        have.add(em)
        new = _new_row(kept, ref, row, alias_map)
        new[flag_col] = "Yes"
        rows.append(new)
    added = None
    if rows:
        added = pd.DataFrame(rows)
        kept = pd.concat([kept, added], ignore_index=True)
        added = added.copy()
        added["Source"] = source
    yes = int((kept[flag_col] == "Yes").sum())
    return StageResult(
        kept=kept,
        added=added,
        stats={"flag_yes": yes, "appended": len(rows), "rows": len(kept)},
        log_lines=[f"{label}: {yes} flagged Yes; appended {len(rows)} not-found users"],
    )


def run(df, aurora_df) -> StageResult:
    return _flag_and_append(
        df,
        aurora_df,
        "E-MAIL",
        config.AURORA_COLUMN,
        {"E-MAIL": config.EMAIL_COLUMN, "NAME": "Employee Name"},
        "Aurora reverse lookup",
        "Aurora",
    )
