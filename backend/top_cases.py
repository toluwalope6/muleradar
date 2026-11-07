"""Print the top 10 cases and overall metrics: python top_cases.py"""
from data import build_dataset
from detect import case_summary, run_detection

df, ground_truth = build_dataset()
results = run_detection(df, ground_truth)

print(f"{'id':<6}{'risk':>5}  {'scheme':<16}{'accts':>6}{'amount':>14}{'hours':>8}  {'ground truth':<16}{'match':>6}")
for c in results.cases[:10]:
    s = case_summary(c)
    gt = c.ground_truth["scheme_type"] if c.ground_truth else "-"
    print(f"{s['id']:<6}{s['risk_score']:>5}  {s['scheme_type']:<16}{s['account_count']:>6}"
          f"{s['total_amount']:>14,.2f}{s['duration_hours']:>8.1f}  {gt:<16}{c.match_score:>6.2f}")
    print(f"      {s['summary']}")

print("\nMetrics:")
for k, v in results.metrics.items():
    print(f"  {k}: {v}")
