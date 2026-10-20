"""Number formatting shared by every dashboard. All money is AED."""

from __future__ import annotations

import math

MISSING = "—"
# Plotly formats for axes and hover labels, matching fmt_aed.
PLOTLY_AED_TICKFORMAT = ",.0f"
PLOTLY_AED_HOVER = "AED %{x:,.0f}"


def _is_missing(value) -> bool:
    return value is None or (isinstance(value, float) and math.isnan(value))


def fmt_number(value, decimals: int = 0) -> str:
    """``1,234,567``; negatives get a leading minus: ``-1,234``. Never shows ``-0``."""
    if _is_missing(value):
        return MISSING
    text = f"{abs(value):,.{decimals}f}"
    return f"-{text}" if round(value, decimals) < 0 else text


def fmt_aed(value, decimals: int = 0) -> str:
    """``AED 1,234,567``; negatives get a leading minus: ``-AED 1,234``."""
    if _is_missing(value):
        return MISSING
    text = f"AED {fmt_number(abs(value), decimals)}"
    return f"-{text}" if round(value, decimals) < 0 else text


def fmt_int(value) -> str:
    if _is_missing(value):
        return MISSING
    return f"{int(value):,}"


def fmt_pct(value, decimals: int = 1) -> str:
    """``value`` is a fraction: 0.1234 -> ``12.3%``."""
    if _is_missing(value):
        return MISSING
    return f"{value * 100:,.{decimals}f}%"


def pct_change(current, previous) -> float | None:
    """Change as a fraction of the previous value's size; ``None`` when there is no base.

    Uses ``abs(previous)`` so the sign always means "went up" or "went down", also for negative
    measures like returns: -120 vs -100 is -20% (more returns).
    """
    if _is_missing(current) or _is_missing(previous) or previous == 0:
        return None
    return (current - previous) / abs(previous)


def fmt_delta_pct(current, previous) -> str | None:
    change = pct_change(current, previous)
    return None if change is None else f"{change * 100:+,.1f}%"


def fmt_delta_pp(current, previous) -> str | None:
    """Difference of two fractions in percentage points."""
    if _is_missing(current) or _is_missing(previous):
        return None
    return f"{(current - previous) * 100:+,.1f} pp"
