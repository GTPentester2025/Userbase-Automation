import pandas as pd
import pytest
from engine import config
from engine.stages import zone_validation, zone_additional


def udf(rows):
    d = {c: ["" for _ in rows] for c in config.REQUIRED_COLUMNS}
    d["Zone"] = [r[0] for r in rows]
    d["Employee Email"] = [r[1] for r in rows]
    df = pd.DataFrame(d)
    df[config.ZONE_VALIDATION_COLUMN] = ""
    return df


def test_zone_validation_keep_remove_pass():
    df = udf([("MAZ", "ok@x.y"), ("MAZ", "bad@x.y"), ("maz ", "notfound@x.y"),
              ("SAZ", "s@x.y"), ("Other", "o@x.y")])
    maz = pd.DataFrame({"Employee Email": [" OK@X.Y ", "bad@x.y"], "Action": ["OK", "Terminate"]})
    r = zone_validation.run(df, {"MAZ": maz})
    assert r.kept["Employee Email"].tolist() == ["ok@x.y", "s@x.y", "o@x.y"]
    assert r.kept[config.ZONE_VALIDATION_COLUMN].tolist() == ["MAZ Validated", "", ""]
    assert sorted(r.removed["Employee Email"]) == ["bad@x.y", "notfound@x.y"]
    assert "SAZ" in r.stats["unvalidated_zones"]


def test_zone_validation_missing_action():
    with pytest.raises(ValueError, match="Action"):
        zone_validation.run(udf([("MAZ", "a@b.c")]), {"MAZ": pd.DataFrame({"Employee Email": []})})


def test_zone_additional_appends_missing_only():
    df = udf([("MAZ", "have@x.y")])
    add = pd.DataFrame({"Employee Email": ["have@x.y", "new@x.y", ""],
                        "Employee Name": ["H", "N", "Z"], "Junk": ["j", "j", "j"]})
    r = zone_additional.run(df, {"MAZ": add})
    assert len(r.kept) == 2
    new = r.kept.iloc[1]
    assert new["Employee Email"] == "new@x.y" and new["Employee Name"] == "N"
    assert new[config.ZONE_VALIDATION_COLUMN] == "MAZ Additional"
    assert "Junk" not in r.kept.columns
    assert r.added["Source"].tolist() == ["Zone MAZ additional tab"]
