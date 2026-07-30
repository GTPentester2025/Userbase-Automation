# Deploy target is RHEL 9 / Python 3.9, where PEP 604 unions (pd.DataFrame | None)
# are a runtime TypeError when the annotation is evaluated at class-definition time.
# Making annotations lazy strings keeps this dataclass importable on 3.9+.
from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd


@dataclass
class StageResult:
    kept: pd.DataFrame
    removed: pd.DataFrame | None = None
    added: pd.DataFrame | None = None
    stats: dict = field(default_factory=dict)
    log_lines: list = field(default_factory=list)
