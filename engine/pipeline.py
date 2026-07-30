from dataclasses import dataclass
from datetime import datetime

import pandas as pd

from engine import config
from engine.io_utils import find_additional_sheet, latest_dated_sheet, read_table
from engine.stages import (
    aurora,
    bsc,
    ceo_exclusion,
    column_filter,
    dedupe,
    email_validation,
    export_final,
    ot_filter,
    ssoupn_o365,
    ssoupn_saviynt,
    zone_additional,
    zone_validation,
)
from engine.types import StageResult


class PipelineError(Exception):
    pass


@dataclass
class Stage:
    n: int
    key: str
    title: str
    needs: list


STAGES = [
    Stage(1, "column_filter", "Column Filter", ["datamart"]),
    Stage(2, "base_userbase", "Base Userbase", []),
    Stage(3, "email_validation", "Email Validation", []),
    Stage(4, "ot_filter", "OT Filter", []),
    Stage(5, "ssoupn_o365", "SSOUPN O365", ["o365"]),
    Stage(6, "ssoupn_saviynt", "SSOUPN Saviynt", ["saviynt"]),
    Stage(7, "zone_validation", "Zone Validation", []),
    Stage(8, "zone_additional", "Zone Additional Append", []),
    Stage(9, "zone_summary", "Zone Loop Summary", []),
    Stage(10, "aurora", "Aurora Validation", ["aurora"]),
    Stage(11, "bsc", "BSC Validation", ["bsc"]),
    Stage(12, "ceo_exclusion", "CEO Exclusion", ["ceo"]),
    Stage(13, "dedupe", "Duplicate Removal", []),
    Stage(14, "export_final", "Final Validation & Export", []),
]
BY_N = {s.n: s for s in STAGES}


def missing_inputs(store, run_id, n):
    inputs = store.manifest(run_id)["inputs"]
    return [slot for slot in BY_N[n].needs if not inputs.get(slot)]


def _log(store, run_id, n, lines):
    p = store.base_dir / run_id / "run_log.txt"
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with p.open("a", encoding="utf-8") as f:
        for line in lines:
            f.write(f"[{ts}] [stage {n:02d}] {line}\n")


def _zone_frames(store, run_id, additional=False):
    frames = {}
    for z in config.ZONES:
        path = store.input_path(run_id, f"zone_{z}")
        if not path:
            continue
        if additional:
            sheet = find_additional_sheet(path)
            if sheet:
                frames[z] = read_table(path, sheet)
        else:
            frames[z] = read_table(path, 0)
    return frames


def _execute(store, run_id, stage) -> StageResult:
    n = stage.n
    if n == 1:
        return column_filter.run(read_table(store.input_path(run_id, "datamart"), 0))
    df = store.load_kept(run_id, n - 1)
    if n == 2:
        if config.ZONE_VALIDATION_COLUMN not in df.columns:
            df[config.ZONE_VALIDATION_COLUMN] = ""
        return StageResult(
            kept=df,
            stats={"rows": len(df)},
            log_lines=["Base Userbase created — master file for the rest of the run"],
        )
    if n == 3:
        return email_validation.run(df)
    if n == 4:
        return ot_filter.run(df)
    if n == 5:
        return ssoupn_o365.run(df, read_table(store.input_path(run_id, "o365"), 0))
    if n == 6:
        return ssoupn_saviynt.run(df, read_table(store.input_path(run_id, "saviynt"), 0))
    if n == 7:
        return zone_validation.run(df, _zone_frames(store, run_id))
    if n == 8:
        return zone_additional.run(df, _zone_frames(store, run_id, additional=True))
    if n == 9:
        m = store.manifest(run_id)
        s7 = m["stages"].get("7", {}).get("stats", {})
        s8 = m["stages"].get("8", {}).get("stats", {})
        stats = {
            "per_zone": s7.get("per_zone", {}),
            "appended_per_zone": s8.get("appended_per_zone", {}),
            "unvalidated_zones": s7.get("unvalidated_zones", []),
        }
        return StageResult(
            kept=df,
            stats=stats,
            log_lines=[
                "Zone loop complete; unvalidated zones: "
                + (", ".join(stats["unvalidated_zones"]) or "none")
            ],
        )
    if n == 10:
        return aurora.run(df, read_table(store.input_path(run_id, "aurora"), 0))
    if n == 11:
        return bsc.run(df, read_table(store.input_path(run_id, "bsc"), 0))
    if n == 12:
        path = store.input_path(run_id, "ceo")
        return ceo_exclusion.run(df, read_table(path, latest_dated_sheet(path)))
    if n == 13:
        return dedupe.run(df)
    if n == 14:
        m = store.manifest(run_id)
        removed_parts = [store.load_frame(run_id, k, "removed") for k in range(1, 14)]
        removed_parts = [r for r in removed_parts if len(r)]
        all_removed = (
            pd.concat(removed_parts, ignore_index=True) if removed_parts else pd.DataFrame()
        )
        stage_stats = {int(k): v.get("stats", {}) for k, v in m["stages"].items()}
        out_dir = store.base_dir / run_id / "final"
        return export_final.run(df, all_removed, stage_stats, out_dir)
    raise PipelineError(f"Unknown stage {n}")


def run_stage(store, run_id, n) -> dict:
    stage = BY_N.get(n)
    if not stage:
        raise PipelineError(f"No such stage: {n}")
    missing = missing_inputs(store, run_id, n)
    if missing:
        raise PipelineError(f"Stage {n} ({stage.title}) needs input(s): {', '.join(missing)}")
    m = store.manifest(run_id)
    m["status"], m["error"] = "running", None
    store.save_manifest(run_id, m)
    try:
        result = _execute(store, run_id, stage)
    except PipelineError:
        raise
    except Exception as e:
        m = store.manifest(run_id)
        m["status"] = "error"
        m["error"] = {"stage": n, "message": str(e)}
        store.save_manifest(run_id, m)
        raise PipelineError(str(e)) from e
    store.save_stage(run_id, n, stage.key, result)
    _log(store, run_id, n, result.log_lines or [f"{stage.title} done"])
    m = store.manifest(run_id)
    m["status"] = "complete" if n == 14 else "idle"
    store.save_manifest(run_id, m)
    return m["stages"][str(n)]


def advance(store, run_id) -> dict:
    frontier = store.manifest(run_id)["frontier"]
    if frontier > 14:
        raise PipelineError("Pipeline already complete")
    return run_stage(store, run_id, frontier)


def run_all(store, run_id):
    out = []
    while store.manifest(run_id)["frontier"] <= 14:
        frontier = store.manifest(run_id)["frontier"]
        if missing_inputs(store, run_id, frontier):
            break
        out.append(advance(store, run_id))
    return out
