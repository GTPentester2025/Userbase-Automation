from engine import config
from engine.stages.ssoupn_o365 import _lookup


def run(df, saviynt_df):
    return _lookup(df, saviynt_df, "User Email", "SSO UPN", config.SAVIYNT_COLUMN, "Saviynt")
