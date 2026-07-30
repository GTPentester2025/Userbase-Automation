import pandas as pd
from engine import config
from engine.stages import column_filter, email_validation, ot_filter, dedupe


def base_df(**over):
    d = {c: ["v"] for c in config.REQUIRED_COLUMNS}
    d["Employee Email"] = ["a@b.c"]
    d.update(over)
    return pd.DataFrame(d)


def test_column_filter_drops_and_fills():
    df = base_df()
    df["Junk"] = ["x"]
    df = df.drop(columns=["Band 4+"])
    r = column_filter.run(df)
    assert list(r.kept.columns) == config.REQUIRED_COLUMNS
    assert "Junk" in r.stats["dropped_columns"]
    assert "Band 4+" in r.stats["missing_columns"]
    assert r.kept["Band 4+"].tolist() == [""]


def test_email_validation():
    df = pd.DataFrame({"Employee Email": ["ok@x.y", "", "NOEMAIL@x.y", "bad.email", "  OK2@X.Y "]})
    r = email_validation.run(df)
    assert r.kept["Employee Email"].tolist() == ["ok@x.y", "  OK2@X.Y "]
    reasons = r.removed["Removal Reason"].tolist()
    assert reasons == ["Blank Employee Email", "Employee Email contains noemail", "Employee Email missing @"]
    assert set(r.removed["Removal Stage"]) == {"Email Validation"}


def test_ot_filter():
    df = pd.DataFrame({
        "Job Family Group": ["SUPPLY", "SUPPLY", "SALES"],
        "Job Family": ["Plant Management", "Plant Management", "Plant Management"],
        "Job Profile Description": ["Brewery Plant Manager", "Chef", "Brewery Plant Manager"],
    })
    r = ot_filter.run(df)
    assert r.kept[config.OT_COLUMN].tolist() == ["Yes", "No", "No"]
    assert r.stats["ot_yes"] == 1


def test_dedupe_keep_first():
    df = pd.DataFrame({"Employee Email": ["A@b.c", "x@y.z", " a@B.C "]})
    r = dedupe.run(df)
    assert r.kept["Employee Email"].tolist() == ["A@b.c", "x@y.z"]
    assert r.removed["Removal Stage"].tolist() == ["Duplicate Removal"]
