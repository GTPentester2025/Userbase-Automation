import pandas as pd
import pytest
from engine import config
from engine.stages import ssoupn_o365, ssoupn_saviynt


def test_o365_maps_and_blanks():
    df = pd.DataFrame({"Employee Email": ["A@b.c", "x@y.z"]})
    o365 = pd.DataFrame({"Mail": [" a@B.C "], "UserPrincipalName": ["a.upn@abi.com"]})
    r = ssoupn_o365.run(df, o365)
    assert r.kept[config.O365_COLUMN].tolist() == ["a.upn@abi.com", ""]
    assert r.stats["matched"] == 1


def test_o365_missing_column():
    with pytest.raises(ValueError, match="Mail"):
        ssoupn_o365.run(pd.DataFrame({"Employee Email": []}), pd.DataFrame({"X": []}))


def test_saviynt_maps():
    df = pd.DataFrame({"Employee Email": ["a@b.c"]})
    sav = pd.DataFrame({"User Email": ["a@b.c"], "SSO UPN": ["sso@abi.com"]})
    r = ssoupn_saviynt.run(df, sav)
    assert r.kept[config.SAVIYNT_COLUMN].tolist() == ["sso@abi.com"]
