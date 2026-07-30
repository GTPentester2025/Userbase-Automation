from engine import config
from engine.types import StageResult


def run(df) -> StageResult:
    dropped = [c for c in df.columns if c not in config.REQUIRED_COLUMNS]
    missing = [c for c in config.REQUIRED_COLUMNS if c not in df.columns]
    kept = df.copy()
    for c in missing:
        kept[c] = ""
    kept = kept[config.REQUIRED_COLUMNS]
    return StageResult(
        kept=kept,
        stats={
            "dropped_columns": dropped,
            "missing_columns": missing,
            "rows": len(kept),
            "columns": len(kept.columns),
        },
        log_lines=[
            f"Kept {len(config.REQUIRED_COLUMNS)} required columns; "
            f"dropped {len(dropped)}; missing (created blank): {len(missing)}"
        ],
    )
