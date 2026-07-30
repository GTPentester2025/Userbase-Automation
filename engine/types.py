from dataclasses import dataclass, field

import pandas as pd


@dataclass
class StageResult:
    kept: pd.DataFrame
    removed: pd.DataFrame | None = None
    added: pd.DataFrame | None = None
    stats: dict = field(default_factory=dict)
    log_lines: list = field(default_factory=list)
