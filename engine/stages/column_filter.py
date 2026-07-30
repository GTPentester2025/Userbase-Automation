from engine import config
from engine.io_utils import norm_series
from engine.types import StageResult


def run(df, zone_filter=None) -> StageResult:
    kept = df.copy()
    zone_removed = None
    zone_log = []
    # Single-zone run: drop every row not in the chosen zone before column filtering.
    if zone_filter:
        col, val = zone_filter.get("column"), zone_filter.get("value")
        if col in kept.columns:
            match = norm_series(kept[col]) == str(val).strip().lower()
            zone_removed = kept[~match].copy()
            zone_removed["Removal Reason"] = f"Not in zone {val} ({col})"
            zone_removed["Removal Stage"] = "Zone Pre-filter"
            kept = kept[match].copy()
            zone_log.append(
                f"Single-zone run: kept {len(kept)} rows in '{val}', "
                f"removed {len(zone_removed)} from other zones"
            )
        else:
            zone_log.append(f"Zone filter column '{col}' not found — no pre-filter applied")

    dropped = [c for c in kept.columns if c not in config.REQUIRED_COLUMNS]
    missing = [c for c in config.REQUIRED_COLUMNS if c not in kept.columns]
    for c in missing:
        kept[c] = ""
    kept = kept[config.REQUIRED_COLUMNS]
    return StageResult(
        kept=kept,
        removed=zone_removed,
        stats={
            "dropped_columns": dropped,
            "missing_columns": missing,
            "rows": len(kept),
            "columns": len(kept.columns),
            "zone_filter": zone_filter or None,
            "zone_removed": 0 if zone_removed is None else len(zone_removed),
        },
        log_lines=zone_log + [
            f"Kept {len(config.REQUIRED_COLUMNS)} required columns; "
            f"dropped {len(dropped)}; missing (created blank): {len(missing)}"
        ],
    )
