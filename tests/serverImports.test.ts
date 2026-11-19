import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');

/** Every .ts file below a folder. */
const filesIn = (folder: string): string[] => readdirSync(path.join(ROOT, folder)).flatMap((name) => {
  const relative = path.join(folder, name);
  return statSync(path.join(ROOT, relative)).isDirectory() ? filesIn(relative) : relative.endsWith('.ts') ? [relative] : [];
});

/** The relative imports a file needs when it runs. Imports of types only are removed by the compiler. */
const runtimeImports = (file: string): string[] => {
  const source = readFileSync(path.join(ROOT, file), 'utf8');
  const found: string[] = [];
  for (const match of source.matchAll(/^\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"](\.{1,2}\/[^'"]+)['"]/gm)) {
    if (!match[1]) found.push(match[2]);
  }
  return found;
};

test('everything the server loads imports its files with the .js ending', () => {
  // The hosting platform runs api/ and server/ as plain Node modules: an import without the
  // ending works in the browser build and in these tests, and fails only once it is deployed.
  // The salon data (src/mockData.ts, src/conversationData.ts and what they import) is loaded there too.
  const queue = [...filesIn('api'), ...filesIn('server')];
  const seen = new Set<string>();
  const problems: string[] = [];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of runtimeImports(file)) {
      if (!specifier.endsWith('.js')) { problems.push(`${file} imports '${specifier}'`); continue; }
      const target = path.join(path.dirname(file), specifier.replace(/\.js$/, '.ts'));
      assert.ok(existsSync(path.join(ROOT, target)), `${file} imports '${specifier}', which does not exist`);
      queue.push(target);
    }
  }
  assert.deepEqual(problems, []);
  // The check really followed the chain into the salon data.
  for (const file of ['src/mockData.ts', 'src/conversationData.ts', 'src/demoSeed.ts', 'src/scheduling.ts']) assert.ok(seen.has(file), file);
  // The browser-only parts stay out of it.
  for (const file of ['src/availability.ts', 'src/demoRequests.ts', 'src/App.tsx']) assert.ok(!seen.has(file), file);
});
