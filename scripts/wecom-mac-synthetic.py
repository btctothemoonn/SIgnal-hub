"""Exercise a pinned Mac exporter/detector with temporary synthetic sources only.

No network, provider, credential loading, LaunchAgent or original Mac outbox.
The macOS POSIX outbox remains a separate Mac-side acceptance check.
"""
import argparse
import hashlib
import json
import secrets
import sqlite3
import sys
import tempfile
import time
from contextlib import closing
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mac-root", required=True)
    parser.add_argument("--device", default="mac-synthetic")
    args = parser.parse_args()
    sys.path.insert(0, str(Path(args.mac_root).resolve()))
    from scripts.test_wxfomo_briefing import briefing_payload, ADDRESS
    from scripts.wxfomo_lan.signal_export import prepare_reports
    from scripts.wxfomo_lan.signal_ca import CAReader, advance_ca
    from scripts.wxfomo_lan.signal_contract import encode_payload
    from scripts.wxfomo_lan.signal_transport import sign_headers

    secret = "TEST-ONLY-wecom-cross-language-synthetic-secret"
    store = "00000000-0000-4000-8000-000000000001"
    with tempfile.TemporaryDirectory(prefix="wecom-synthetic-source-") as directory:
        messages_path = str(Path(directory) / "messages.sqlite3")
        analysis_path = str(Path(directory) / "analysis.sqlite3")
        inserted = time.time()
        with closing(sqlite3.connect(messages_path)) as db:
            db.execute("CREATE TABLE messages(id INTEGER PRIMARY KEY,event_id TEXT,group_name TEXT,sender_display_name TEXT,content TEXT,message_type TEXT,observed_at REAL,source_sequence INTEGER,record_version INTEGER,inserted_at REAL)")
            for index, group, sender in ((1, "合成研究甲群", "合成昵称甲"), (2, "合成研究乙群", "合成昵称乙")):
                db.execute("INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?,?)", (index, "e" + str(index), group, sender, "Base CA: " + ADDRESS + " SYNTHETIC_RAW_SENTINEL", "text", inserted, index, 1, inserted))
            db.commit()
        source_committed = time.time()
        with closing(sqlite3.connect(analysis_path)) as db:
            db.executescript("CREATE TABLE analysis_results(analysis_id INTEGER,job_id TEXT,result_json TEXT,model TEXT,created_at REAL); CREATE TABLE analysis_jobs(job_id TEXT,state TEXT,cadence TEXT,window_start REAL,window_end REAL,source_event_ids_json TEXT);")
            db.execute("INSERT INTO analysis_results VALUES(?,?,?,?,?)", (1, "synthetic-" + str(inserted), json.dumps(briefing_payload()), "synthetic-existing-result-no-ai-call", source_committed))
            db.execute("INSERT INTO analysis_jobs VALUES(?,?,?,?,?,?)", ("synthetic-" + str(inserted), "succeeded", "two_hour", inserted - 7200, source_committed, '["e1","e2"]'))
            db.commit()
        exported = prepare_reports(analysis_path, messages_path, 0, args.device, store)
        assert len(exported) == 1 and exported[0]["error_code"] is None
        report_body = exported[0]["payload"]
        report = json.loads(report_body)
        assert report["report"]["sources"] == []
        assert "SYNTHETIC_RAW_SENTINEL" not in report_body.decode("utf-8")
        assert (report["report"]["caDiscussions"][0]["uniqueStatementCount"], report["report"]["caDiscussions"][0]["duplicateCount"]) == (2, 0)
        rows = CAReader(messages_path).after_row_id(0, 500)
        detected = time.time()
        derived = advance_ca({}, rows, detected, 0, args.device, store)
        assert len(derived["alerts"]) == 1
        ca_body = encode_payload(derived["alerts"][0])
        packets = []
        for body in (report_body, ca_body):
            packets.append({"body": body.decode("utf-8"), "sha256": hashlib.sha256(body).hexdigest(), "headers": sign_headers(body, args.device, secret, int(time.time()), secrets.token_hex(16))})
        result = {"packets": packets, "timing": {"insertedAt": inserted, "sourceCommittedAt": source_committed, "detectedAt": detected, "exportedAt": time.time()}, "outboxTested": False}
        sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False).encode("utf-8"))


if __name__ == "__main__":
    main()
