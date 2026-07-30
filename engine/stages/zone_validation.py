import pandas as pd

from engine import config
from engine.io_utils import norm_series
from engine.types import StageResult


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
        ok = set(
            norm_series(zf[config.EMAIL_COLUMN])[
                zf["Action"].fillna("").astype(str).str.strip().str.upper() == "OK"
            ]
        ) - {""}
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
    return StageResult(
        kept=kept,
        removed=removed,
        stats={"per_zone": per_zone, "unvalidated_zones": unvalidated, "rows": len(kept)},
        log_lines=logs,
    )
