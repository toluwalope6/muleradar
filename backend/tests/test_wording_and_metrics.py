"""Checks for case/report wording and metric counts. Run from backend/: python -m unittest discover -s tests"""
import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from detect import case_detail, detect_cycles, run_detection  # noqa: E402
from llm import template_answer, template_report  # noqa: E402

T0 = pd.Timestamp("2022-09-01 08:00")


def _df() -> pd.DataFrame:
    # Loop B -> C -> A -> B in time order, so the loop starts at B (not at whichever node networkx lists first),
    # plus one labelled transfer that no detector flags.
    rows = [
        ("T1", T0, "B", "C", 10_000.0, 1),
        ("T2", T0 + pd.Timedelta(hours=1), "C", "A", 9_800.0, 1),
        ("T3", T0 + pd.Timedelta(hours=2), "A", "B", 9_600.0, 1),
        ("T4", T0 + pd.Timedelta(days=9), "D", "E", 50.0, 1),
    ]
    df = pd.DataFrame(rows, columns=["tx_id", "timestamp", "from_account", "to_account", "amount", "is_laundering"])
    df["currency"] = "USD"
    return df


GROUND_TRUTH = [{"scheme_id": "GT1", "type": "CYCLE", "accounts": ["A", "B", "C"], "transactions": ["T1", "T2", "T3"]}]


class CycleWording(unittest.TestCase):
    def test_reason_names_the_account_that_sent_the_first_transfer(self):
        [hit] = detect_cycles(_df())
        self.assertTrue(hit.reason.startswith("3-hop cycle: B sent 10,000.00 and 9,600.00 returned to it"), hit.reason)
        self.assertIn("total across the 3 transfers 29,400.00", hit.reason)
        self.assertNotIn("volume", hit.reason)


class CaseAndReportWording(unittest.TestCase):
    def setUp(self):
        results = run_detection(_df(), GROUND_TRUTH)
        self.assertEqual(len(results.cases), 1)
        self.case = results.cases[0]
        self.detail = case_detail(self.case)

    def test_summary_calls_the_sum_a_total_across_transfers(self):
        self.assertIn("Total across transfers: 29,400.00", self.case.summary)
        self.assertIn("not unique funds", self.case.summary)
        self.assertNotIn(" moved ", self.case.summary)

    def test_report_separates_total_from_detector_amounts(self):
        report = template_report(self.detail)
        self.assertIn("**Total across transfers:** 29,400.00 over 3 transfers", report)
        self.assertIn("not unique funds or money lost", report)
        self.assertNotIn("Total value", report)
        self.assertIn("Detector finding (cycle): 3-hop cycle: B sent 10,000.00 and 9,600.00 returned to it", report)
        self.assertNotIn("most of each inflow forwarded on", report)

    def test_amount_answer_uses_total_across_transfers(self):
        answer = template_answer(self.detail, "How much money?")
        self.assertIn("Total across 3 transfers", answer)
        self.assertNotIn("moved", answer)


class Metrics(unittest.TestCase):
    def test_counts_behind_each_metric(self):
        m = run_detection(_df(), GROUND_TRUTH).metrics
        self.assertEqual((m["true_positive_transactions"], m["flagged_transactions"], m["labelled_laundering"]), (3, 3, 4))
        self.assertEqual((m["precision"], m["recall"]), (1.0, 0.75))
        self.assertEqual((m["schemes_found"], m["schemes_total"], m["schemes_type_correct"]), (1, 1, 1))
        self.assertEqual(m["laundering_in_schemes"], 3)


class SampleCache(unittest.TestCase):
    def _matches(self, dataset, meta, csv_present=False):
        import json
        import tempfile

        import data

        with tempfile.TemporaryDirectory() as tmp:
            if meta is not None:
                (Path(tmp) / data.SAMPLE_META_FILE).write_text(json.dumps(meta))
            if csv_present:
                (Path(tmp) / data.IBM_TRANS).write_text("")
            old, data.DATASET = data.DATASET, dataset
            try:
                return data._cache_matches(Path(tmp))
            finally:
                data.DATASET = old

    def test_rebuilds_when_the_requested_dataset_changes(self):
        self.assertFalse(self._matches("ibm", {"dataset": "synthetic", "requested": "synthetic"}))
        self.assertFalse(self._matches("synthetic", {"dataset": "ibm", "requested": "ibm"}))

    def test_keeps_synthetic_fallback_and_legacy_cache(self):
        self.assertTrue(self._matches("ibm", {"dataset": "synthetic", "requested": "ibm"}))
        self.assertTrue(self._matches("local", {"dataset": "ibm", "requested": "ibm"}))
        self.assertTrue(self._matches("ibm", None))

    def test_rebuilds_fallback_once_ibm_csv_is_available(self):
        self.assertFalse(self._matches("local", {"dataset": "synthetic", "requested": "ibm"}, csv_present=True))
        self.assertFalse(self._matches("ibm", {"dataset": "synthetic", "requested": "ibm"}, csv_present=True))

    def test_legacy_cache_is_not_trusted_for_synthetic(self):
        self.assertFalse(self._matches("synthetic", None))


if __name__ == "__main__":
    unittest.main()
