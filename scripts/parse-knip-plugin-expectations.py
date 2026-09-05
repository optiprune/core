from pathlib import Path
import json
import re

root = Path('/home/ubuntu/knip-main/knip-main/packages/knip')
out = {}
for test_path in sorted((root / 'test/plugins').glob('*.test.ts')):
    text = test_path.read_text()
    fixtures = re.findall(r"fixtures/plugins/([^'\")]+)", text)
    if not fixtures:
        continue
    assertions = []
    for kind, file_name, value in re.findall(
        r"issues\.(unlisted|unresolved|files|exports|dependencies|devDependencies)\[['\"]([^'\"]+)['\"]\](?:\[['\"]([^'\"]+)['\"]\])?",
        text,
    ):
        assertions.append({"kind": kind, "file": file_name, "value": value})
    for file_name, kind in re.findall(
        r"assert\((?:!\()?['\"]([^'\"]+)['\"] in issues\.(files|exports)", text
    ):
        assertions.append({"kind": kind, "file": file_name, "value": None})
    for fixture in fixtures:
        bucket = out.setdefault(fixture, {"tests": [], "assertions": []})
        bucket["tests"].append(test_path.name)
        bucket["assertions"].extend(assertions)
for value in out.values():
    value["tests"] = sorted(set(value["tests"]))
    unique = []
    seen = set()
    for assertion in value["assertions"]:
        key = tuple(assertion.items())
        if key not in seen:
            seen.add(key)
            unique.append(assertion)
    value["assertions"] = unique
Path('/home/ubuntu/optiprune-core/tests/fixtures/plugin-expectations.json').write_text(
    json.dumps(out, indent=2, sort_keys=True) + '\n'
)
print(json.dumps({"fixtures": len(out), "assertions": sum(len(v["assertions"]) for v in out.values())}, indent=2))
