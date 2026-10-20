"""Regenerate the synthetic sample fixtures in mbal_bi/sample_data/.

    python scripts/generate_sample_data.py

Deterministic (fixed seed). Every name is invented; nothing here comes from Orion. Columns use the
real ZF_CSL_BI names so the dashboard SQL runs unchanged in sample mode. Dates cover two full
years; sample mode shifts them so the later year becomes the current year.
"""

from __future__ import annotations

import csv
import random
from datetime import date, timedelta
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent.parent / "mbal_bi" / "sample_data"
FIRST_YEAR = 2025
YEARS = 2
SEED = 1924

COMPANIES = [
    ("101", "Sample Trading LLC"),
    ("102", "Demo Medical Supplies LLC"),
    ("103", "Example Industrial Co"),
    ("104", "Placeholder Foods FZE"),
    ("105", "Fictional Tech Distribution"),
]
SALESPEOPLE = ["Aisha Rahman", "Omar Haddad", "Priya Nair", "Daniel Costa", "Lina Saeed", None]
GROUPS = ["Consumables", "Equipment", "Spare Parts", "Services", "Packaging", "Chemicals", None]
CUSTOMER_WORDS = ["Al Noor", "Desert Star", "Blue Gulf", "Palm", "Horizon", "Crescent", "Oasis",
                  "Falcon", "Pearl", "Summit", "Harbor", "Cedar"]
CUSTOMER_KINDS = ["Trading", "Hospital", "Contracting", "Hotel", "Clinic"]

COLUMNS = [
    "CSL_COMP_CODE", "CSL_COMP_NAME", "CSL_TXN_TYPE", "CSL_TXN_CODE", "CSL_NO", "CSL_DATE",
    "CSL_SM_NAME", "CSL_CUST_CODE", "CSL_CUST_NAME", "CSL_ITEM_CODE", "CSL_NAME",
    "CSL_GROUP_NAME", "CSL_QTY", "CSL_WAC_VALUE", "CSL_NET_SL_VALUE", "CSL_GROSS_SL_VALUE",
]


def main() -> None:
    rng = random.Random(SEED)
    customers = [
        (f"C{index:04d}", f"{rng.choice(CUSTOMER_WORDS)} {rng.choice(CUSTOMER_KINDS)} {index}")
        for index in range(1, 46)
    ]
    customers.append(("C9999", None))  # a customer with no name, shown as 'Unassigned'
    items = [
        (f"IT{index:05d}", f"Sample item {index:03d}", rng.choice(GROUPS), rng.uniform(15, 900))
        for index in range(1, 81)
    ]
    rows = []
    doc_no = 1000
    start = date(FIRST_YEAR, 1, 1)
    days = (date(FIRST_YEAR + YEARS, 1, 1) - start).days
    for _ in range(900):
        doc_no += 1
        company = rng.choices(COMPANIES, weights=[5, 3, 2, 1, 1])[0]
        day = start + timedelta(days=rng.randrange(days))
        customer = rng.choice(customers)
        salesperson = rng.choice(SALESPEOPLE)
        kind = rng.choices(["invoice", "return", "delivery"], weights=[85, 9, 6])[0]
        if kind == "return":
            txn_type, txn_code, sign = "SARTN", "SRU", -1
        elif kind == "delivery":
            txn_type, txn_code, sign = "INV", "DNP", 1
        else:
            txn_type, txn_code, sign = "INV", rng.choice(["IU5", "IN5"]), 1
        for _ in range(rng.randint(1, 4)):
            item = rng.choice(items)
            qty = rng.randint(1, 40)
            cost = round(qty * item[3], 2)
            net = round(cost * rng.uniform(1.1, 1.6), 2)
            gross = round(net * rng.uniform(1.0, 1.1), 2)
            if kind == "delivery":
                net = gross = 0.0  # delivery notes carry the cost but no revenue
            rows.append({
                "CSL_COMP_CODE": company[0],
                "CSL_COMP_NAME": company[1],
                "CSL_TXN_TYPE": txn_type,
                "CSL_TXN_CODE": txn_code,
                "CSL_NO": doc_no,
                "CSL_DATE": day.isoformat(),
                "CSL_SM_NAME": salesperson,
                "CSL_CUST_CODE": customer[0],
                "CSL_CUST_NAME": customer[1],
                "CSL_ITEM_CODE": item[0],
                "CSL_NAME": item[1],
                "CSL_GROUP_NAME": item[2],
                "CSL_QTY": sign * qty,
                "CSL_WAC_VALUE": sign * cost,
                "CSL_NET_SL_VALUE": sign * net,
                "CSL_GROSS_SL_VALUE": sign * gross,
            })
    rows.sort(key=lambda row: (row["CSL_DATE"], row["CSL_NO"]))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUT_DIR / "ZF_CSL_BI.csv", "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} rows to {OUT_DIR / 'ZF_CSL_BI.csv'}")


if __name__ == "__main__":
    main()
