from engine import config
from engine.io_utils import norm_series
from engine.types import StageResult


def run(df) -> StageResult:
    emails = norm_series(df[config.EMAIL_COLUMN])
    blank = emails == ""
    noemail = ~blank & emails.str.contains("noemail")
    no_at = ~blank & ~noemail & ~emails.str.contains("@")
    bad = blank | noemail | no_at
    removed = df[bad].copy()
    removed["Removal Reason"] = ""
    removed.loc[blank[bad], "Removal Reason"] = "Blank Employee Email"
    removed.loc[noemail[bad], "Removal Reason"] = "Employee Email contains noemail"
    removed.loc[no_at[bad], "Removal Reason"] = "Employee Email missing @"
    removed["Removal Stage"] = "Email Validation"
    kept = df[~bad].copy()
    stats = {
        "removed_blank": int(blank.sum()),
        "removed_noemail": int(noemail.sum()),
        "removed_no_at": int(no_at.sum()),
        "rows": len(kept),
    }
    return StageResult(
        kept=kept,
        removed=removed,
        stats=stats,
        log_lines=[
            f"Removed {len(removed)} rows (blank {stats['removed_blank']}, "
            f"noemail {stats['removed_noemail']}, no-@ {stats['removed_no_at']})"
        ],
    )
