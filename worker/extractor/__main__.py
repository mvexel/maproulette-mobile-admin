import argparse
import json
import sys

from .convert import extract_features, load_region, parse_rules


def main() -> int:
    p = argparse.ArgumentParser(description="PBF -> survey feature FeatureCollection")
    p.add_argument("pbf")
    p.add_argument("--match", action="append", required=True,
                   help="rule 'k=v[,k2=v2]' (AND within a rule); repeat for OR")
    p.add_argument("--region", help="GeoJSON polygon file")
    p.add_argument("--out", required=True)
    p.add_argument("--report", help="write report JSON here (default stderr)")
    a = p.parse_args()
    rules = parse_rules([dict(kv.split("=", 1) for kv in m.split(",")) for m in a.match])
    region = load_region(json.load(open(a.region))) if a.region else None
    res = extract_features(a.pbf, rules, region=region)
    with open(a.out, "w") as f:
        json.dump(res.feature_collection, f)
    rep = json.dumps(res.report.to_dict(), indent=2)
    if a.report:
        open(a.report, "w").write(rep)
    else:
        print(rep, file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
