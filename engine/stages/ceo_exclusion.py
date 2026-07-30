from engine import config
from engine.io_utils import norm_series
from engine.types import StageResult


def run(df, ceo_df) -> StageResult:
    if "Mail ID" not in ceo_df.columns:
        raise ValueError("CEO file missing required column: Mail ID")
    ceo = set(norm_series(ceo_df["Mail ID"])) - {""}
    mask = (
        norm_series(df[config.EMAIL_COLUMN]).isin(ceo)
        | norm_series(df[config.O365_COLUMN]).isin(ceo)
        | norm_series(df[config.SAVIYNT_COLUMN]).isin(ceo)
    )
    removed = df[mask].copy()
    removed["Removal Reason"] = "Matched CEO Mail ID"
    removed["Removal Stage"] = "CEO Exclusion"
    return StageResult(
        kept=df[~mask].copy(),
        removed=removed,
        stats={"removed": int(mask.sum()), "rows": int((~mask).sum())},
        log_lines=[f"Removed {int(mask.sum())} CEO-matched users"],
    )
