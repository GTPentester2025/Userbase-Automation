from engine import config
from engine.stages.aurora import _flag_and_append


def run(df, bsc_df):
    return _flag_and_append(
        df,
        bsc_df,
        "Email - Primary Work",
        config.BSC_COLUMN,
        {"Email - Primary Work": config.EMAIL_COLUMN},
        "BSC reverse lookup",
        "BSC",
    )
