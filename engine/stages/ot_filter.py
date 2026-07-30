from engine import config
from engine.types import StageResult


def run(df) -> StageResult:
    kept = df.copy()
    ok = (
        kept["Job Family Group"].str.strip().str.upper().isin(
            [v.upper() for v in config.OT_JOB_FAMILY_GROUP]
        )
        & kept["Job Family"].str.strip().isin(config.OT_JOB_FAMILY)
        & kept["Job Profile Description"].str.strip().isin(config.OT_JOB_PROFILES)
    )
    kept[config.OT_COLUMN] = ok.map({True: "Yes", False: "No"})
    return StageResult(
        kept=kept,
        stats={"ot_yes": int(ok.sum()), "rows": len(kept)},
        log_lines=[f"OT = Yes for {int(ok.sum())} of {len(kept)} rows"],
    )
