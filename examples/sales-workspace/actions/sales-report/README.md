# Sales Report

Turns the latest sales spreadsheet into a clear weekly summary.

## Before you run

- Add a file named `sales.csv` to the workspace Files area.
- Include `date`, `product`, `region`, and `amount` columns.

## How to use

1. Replace `sales.csv` whenever new sales data is available.
2. Click **Run** on the Sales Report card.
3. Open or download `report.html` from Outputs when the run succeeds.

Running the Action again replaces the previous report. Your source spreadsheet is never changed.

## Outputs

- `outputs/report.html` — a printable weekly sales summary you can open in a browser.
- `outputs/summary.json` — the calculated totals used to create the report.
