import math

from mbal_bi import formatting


def test_fmt_aed_thousands_and_negatives():
    assert formatting.fmt_aed(1234567.4) == "AED 1,234,567"
    assert formatting.fmt_aed(-1234.5, decimals=1) == "-AED 1,234.5"
    assert formatting.fmt_aed(0) == "AED 0"
    assert formatting.fmt_aed(-0.2) == "AED 0"
    assert formatting.fmt_aed(None) == formatting.MISSING
    assert formatting.fmt_aed(math.nan) == formatting.MISSING
    assert formatting.fmt_number(-46432905.3) == "-46,432,905"


def test_pct_and_counts():
    assert formatting.fmt_pct(0.34634) == "34.6%"
    assert formatting.fmt_int(12345) == "12,345"
    assert formatting.fmt_delta_pp(0.35, 0.30) == "+5.0 pp"


def test_pct_change_is_sign_aware():
    assert formatting.pct_change(110, 100) == 0.1
    assert formatting.pct_change(-120, -100) == -0.2  # more returns shows as a fall
    assert formatting.pct_change(5, 0) is None
    assert formatting.fmt_delta_pct(90, 100) == "-10.0%"
