/**
 * Project scan for files worth managing (plan §5).
 *
 * The rules are a table rather than a chain of name tests, because each one
 * carries two decisions that must stay together: whether the file qualifies,
 * and which group kind it suggests.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expandHome, isWithin } from '../../utils/paths';
import { detectFormat } from '../../../shared/credentials/formats';
import type { FileFormat, GroupKind } from '../../../shared/credentials/types';
import { CredError } from './CredentialStore';

export interface DiscoveredFile {
  absolutePath: string;
  relativePath: string;
  format: FileFormat;
  suggestedKind: GroupKind;
}

interface DiscoveryRule {
  matches(fileName: string, relativeDir: string): boolean;
  kind(absolutePath: string): GroupKind;
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'vendor',
  'tmp',
  '.terraform',
]);

const EXAMPLE_NAMES = new Set(['.env.example', '.env.sample', '.env.template']);

/** A scan that reaches either cap stops there; a project this large is misconfigured. */
const MAX_DEPTH = 6;
const MAX_VISITED = 5000;

function isExample(fileName: string): boolean {
  return EXAMPLE_NAMES.has(fileName) || fileName.endsWith('.example');
}

const DISCOVERY_RULES: DiscoveryRule[] = [
  {
    matches: (_fileName, relativeDir) => relativeDir.includes('.kamal/keys'),
    kind: () => 'kamal',
  },
  {
    matches: fileName => fileName.endsWith('.tfvars'),
    kind: () => 'terraform',
  },
  {
    matches: fileName =>
      (fileName === '.env' || fileName.startsWith('.env.')) && !isExample(fileName),
    kind: absolutePath =>
      fs.existsSync(path.join(path.dirname(absolutePath), 'Gemfile')) ? 'rails' : 'generic',
  },
];

export function scanProject(rootPath: string): DiscoveredFile[] {
  const root = path.resolve(expandHome(rootPath));

  let stats: fs.Stats;
  try {
    stats = fs.statSync(root);
  } catch {
    throw new CredError('not-found', 'that directory does not exist');
  }
  if (!stats.isDirectory()) {
    throw new CredError('bad-request', 'the scan target is not a directory');
  }
  // Plan §5: never walk a home directory, and never an ancestor of one either,
  // which is the same mistake reached by picking `/` or `/Users`.
  if (isWithin(root, os.homedir())) {
    throw new CredError('policy', 'choose a project directory, not the home directory or one of its ancestors');
  }

  const found: DiscoveredFile[] = [];
  const pending: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  let visited = 0;

  while (pending.length > 0) {
    const current = pending.pop() as { dir: string; depth: number };

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (++visited > MAX_VISITED) return found;
      const absolutePath = path.join(current.dir, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || current.depth + 1 > MAX_DEPTH) continue;
        pending.push({ dir: absolutePath, depth: current.depth + 1 });
        continue;
      }
      // A symlink reports neither `isFile` nor `isDirectory`, so a linked
      // credential file is left for the user to add by hand rather than
      // followed out of the project.
      if (!entry.isFile()) continue;

      const relativePath = path.relative(root, absolutePath);
      const relativeDir = path.dirname(relativePath).split(path.sep).join('/');
      const rule = DISCOVERY_RULES.find(candidate => candidate.matches(entry.name, relativeDir));
      if (!rule) continue;

      found.push({
        absolutePath,
        relativePath,
        format: detectFormat(absolutePath),
        suggestedKind: rule.kind(absolutePath),
      });
    }
  }

  return found;
}
