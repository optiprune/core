from pathlib import Path
import json
import re

repo = Path('/home/ubuntu/optiprune-core')
manifest = json.loads((repo / 'tests/fixtures/plugins/_metadata/plugin-expectations.json').read_text())
by_test = {}
for fixture, data in manifest.items():
    for test_name in data['tests']:
        by_test.setdefault(test_name, []).append(fixture)

for test_path in sorted((repo / 'tests/Plugins').glob('*.test.ts')):
    text = test_path.read_text()
    if 'assertPackagePlugin' not in text:
        continue
    match = re.search(r'assertPackagePlugin\("([^"]+)"\)', text)
    if not match:
        continue
    test_name = test_path.name
    fixtures = sorted(set(by_test.get(test_name, [])))
    if not fixtures:
        raise SystemExit(f'No Knip fixture mapping for {test_name}')
    fixture_literal = ',\n  '.join(json.dumps(name) for name in fixtures)
    title = test_path.stem.replace('.test', '')
    test_path.write_text(f'''import path from "node:path";\nimport {{ describe, it }} from "vitest";\nimport {{ assertKnipFixture, fixturesRoot }} from "./fixture-helper.js";\n\nconst fixtureNames = [\n  {fixture_literal},\n] as const;\n\ndescribe("{title} plugin", () => {{\n  it.each(fixtureNames)("matches the Knip fixture %s", async (fixtureName) => {{\n    const rootDir = path.join(fixturesRoot, fixtureName);\n    await assertKnipFixture(rootDir);\n  }});\n}});\n''')
    print(test_path.name, fixtures)
