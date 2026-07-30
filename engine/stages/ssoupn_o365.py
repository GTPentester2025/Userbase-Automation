from engine import config
from engine.io_utils import norm_series
from engine.types import StageResult


def _lookup(df, ref, key_col, val_col, out_col, label):
    for c in (key_col, val_col):
        if c not in ref.columns:
            raise ValueError(f"{label} file missing required column: {c}")
    mapping = dict(zip(norm_series(ref[key_col]), ref[val_col].fillna("").astype(str)))
    mapping.pop("", None)
    kept = df.copy()
    kept[out_col] = norm_series(kept[config.EMAIL_COLUMN]).map(mapping).fillna("")
    matched = int((kept[out_col] != "").sum())
    return StageResult(
        kept=kept,
        stats={"matched": matched, "rows": len(kept)},
        log_lines=[f"{label}: matched {matched} of {len(kept)} rows"],
    )


def run(df, o365_df) -> StageResult:
    return _lookup(df, o365_df, "Mail", "UserPrincipalName", config.O365_COLUMN, "O365")
