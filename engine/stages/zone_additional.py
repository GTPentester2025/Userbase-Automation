import pandas as pd

from engine import config
from engine.io_utils import is_valid_email, norm_email, norm_series
from engine.types import StageResult


def run(df, additional_frames: dict) -> StageResult:
    kept = df.copy()
    added_parts, logs, per_zone = [], [], {}
    have = set(norm_series(kept[config.EMAIL_COLUMN])) - {""}
    for z, af in additional_frames.items():
        if config.EMAIL_COLUMN not in af.columns:
            raise ValueError(f"Zone {z} additional tab missing required column: {config.EMAIL_COLUMN}")
        rows = []
        for _, row in af.iterrows():
            em = norm_email(row[config.EMAIL_COLUMN])
            # Only append valid, not-already-present emails (SOP Step 3 rule).
            if em in have or not is_valid_email(row[config.EMAIL_COLUMN]):
                continue
            have.add(em)
            new = {c: "" for c in kept.columns}
            for c in kept.columns:
                if c in af.columns:
                    new[c] = str(row[c]) if pd.notna(row[c]) else ""
            new[config.ZONE_VALIDATION_COLUMN] = f"{z} Additional"
            # Appended after the OT stage — default OT so the checklist stays clean.
            if config.OT_COLUMN in kept.columns and not new.get(config.OT_COLUMN):
                new[config.OT_COLUMN] = "No"
            rows.append(new)
        per_zone[z] = len(rows)
        logs.append(f"{z}: appended {len(rows)} additional users")
        if rows:
            part = pd.DataFrame(rows)
            kept = pd.concat([kept, part], ignore_index=True)
            part = part.copy()
            part["Source"] = f"Zone {z} additional tab"
            added_parts.append(part)
    added = pd.concat(added_parts, ignore_index=True) if added_parts else None
    return StageResult(
        kept=kept,
        added=added,
        stats={"appended_per_zone": per_zone, "rows": len(kept)},
        log_lines=logs,
    )
