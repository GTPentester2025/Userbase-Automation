import pandas as pd
from engine import config
from engine.stages import aurora, bsc, ceo_exclusion


def udf(emails, **cols):
    d = {c: ["" for _ in emails] for c in config.REQUIRED_COLUMNS}
    d["Employee Email"] = emails
    d.update(cols)
    df = pd.DataFrame(d)
    for c in (config.ZONE_VALIDATION_COLUMN, config.O365_COLUMN, config.SAVIYNT_COLUMN):
        if c not in df.columns:
            df[c] = ["" for _ in emails]
    return df


def test_aurora_flags_and_appends():
    df = udf(["in@x.y", "out@x.y"])
    au = pd.DataFrame({"E-MAIL": [" IN@X.Y ", "new@x.y"], "NAME": ["In", "New"]})
    r = aurora.run(df, au)
    assert r.kept[config.AURORA_COLUMN].tolist() == ["Yes", "No", "Yes"]
    assert r.kept["Employee Email"].tolist()[-1] == "new@x.y"
    assert r.kept["Employee Name"].tolist()[-1] == "New"
    assert r.added["Source"].tolist() == ["Aurora reverse lookup"]


def test_bsc_flags_and_appends():
    df = udf(["in@x.y"])
    b = pd.DataFrame({"Email - Primary Work": ["in@x.y", "nb@x.y"]})
    r = bsc.run(df, b)
    assert r.kept[config.BSC_COLUMN].tolist() == ["Yes", "Yes"]
    assert r.kept["Employee Email"].tolist()[-1] == "nb@x.y"


def test_ceo_removes_on_any_field():
    df = udf(["a@x.y", "b@x.y", "c@x.y", "d@x.y"])
    df[config.O365_COLUMN] = ["", "hit2@x.y", "", ""]
    df[config.SAVIYNT_COLUMN] = ["", "", "hit3@x.y", ""]
    ceo = pd.DataFrame({"Mail ID": ["A@X.Y", "hit2@x.y", "HIT3@x.y"]})
    r = ceo_exclusion.run(df, ceo)
    assert r.kept["Employee Email"].tolist() == ["d@x.y"]
    assert len(r.removed) == 3
    assert set(r.removed["Removal Stage"]) == {"CEO Exclusion"}
