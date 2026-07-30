from engine import config
from engine.io_utils import norm_series
from engine.types import StageResult


def run(df) -> StageResult:
    dup = norm_series(df[config.EMAIL_COLUMN]).duplicated(keep="first")
    removed = df[dup].copy()
    removed["Removal Reason"] = "Duplicate Employee Email; first occurrence retained"
    removed["Removal Stage"] = "Duplicate Removal"
    kept = df[~dup].copy()
    return StageResult(
        kept=kept,
        removed=removed,
        stats={"duplicates_removed": int(dup.sum()), "rows": len(kept)},
        log_lines=[f"Removed {int(dup.sum())} duplicate email rows"],
    )
