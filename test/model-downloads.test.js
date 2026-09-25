const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
// The app's better-sqlite3 is built for Electron's ABI; Node's own SQLite has the same surface.
const { DatabaseSync } = require('node:sqlite');

// The managed model directory lives under the home directory, so point HOME at a scratch folder.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tiginal-downloads-home-'));
process.env.HOME = home;
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const {
  defaultManagedModelDirectory,
  downloadDirectoryName,
  downloadResumeDecision,
  ModelLibraryService,
} = require('../dist/main/main/models/ModelLibraryService.js');

const FILE_BYTES = Buffer.from('0123456789abcdefghij');

function downloadsDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE model_downloads (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      repo_id TEXT NOT NULL,
      revision TEXT NOT NULL,
      file_path TEXT,
      target_path TEXT NOT NULL,
      status TEXT NOT NULL,
      downloaded_bytes INTEGER NOT NULL DEFAULT 0,
      total_bytes INTEGER,
      error TEXT,
      etag TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

const ETAG = '"sha256-of-model"';

function insertDownload(db, { id, status, targetPath, etag = ETAG }) {
  db.prepare(`
    INSERT INTO model_downloads (id, source, repo_id, revision, file_path, target_path, status,
      downloaded_bytes, total_bytes, error, etag, created_at, updated_at)
    VALUES (?, 'huggingface', 'netease-youdao/Confucius4-R2T2-GGUF', 'main', 'nested/model.gguf', ?, ?, 8, ?, ?, ?, 1, 1)
  `).run(id, targetPath, status, FILE_BYTES.length, status === 'failed' ? 'Tiginal exited before the download completed' : null, etag);
}

// Serves `bytes` like the Hugging Face CDN: Range is honored and a stale If-Range still gets a 206.
function fakeCdn(bytes, etag) {
  const requests = [];
  const fetch = async (url, init) => {
    const headers = init.headers ?? {};
    requests.push({ range: headers.Range, ifRange: headers['If-Range'] });
    const start = Number(/bytes=(\d+)-/.exec(headers.Range ?? '')?.[1] ?? 0);
    const responseHeaders = { etag };
    if (headers.Range) responseHeaders['content-range'] = `bytes ${start}-${bytes.length - 1}/${bytes.length}`;
    return new Response(bytes.subarray(start), { status: headers.Range ? 206 : 200, headers: responseHeaders });
  };
  return { fetch, requests };
}

function preparePartial(name) {
  const targetPath = path.join(defaultManagedModelDirectory(), name);
  const destination = path.join(targetPath, 'nested', 'model.gguf');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(`${destination}.partial`, FILE_BYTES.subarray(0, 8));
  return { targetPath, destination };
}

function storedEtag(db, id) {
  return db.prepare('SELECT etag FROM model_downloads WHERE id = ?').get(id).etag;
}

async function waitForStatus(library, id, status) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const download = library.listDownloads().find(item => item.id === id);
    if (download?.status === status) return download;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Download ${id} did not reach ${status}`);
}

test('resuming with an unchanged ETag appends to the partial file using Range and If-Range', async t => {
  const { targetPath, destination } = preparePartial('huggingface--resume');
  const cdn = fakeCdn(FILE_BYTES, ETAG);
  const originalFetch = global.fetch;
  global.fetch = cdn.fetch;
  t.after(() => { global.fetch = originalFetch; });

  const db = downloadsDatabase();
  insertDownload(db, { id: 'resume-1', status: 'failed', targetPath });
  const library = new ModelLibraryService(db);
  library.scanDownloadedModels = async () => [];

  const resumed = library.resumeDownload('resume-1');
  assert.equal(['queued', 'downloading'].includes(resumed.status), true);
  assert.equal(resumed.error, null);
  const completed = await waitForStatus(library, 'resume-1', 'completed');

  assert.equal(completed.downloadedBytes, FILE_BYTES.length);
  assert.deepEqual(cdn.requests, [{ range: 'bytes=8-', ifRange: ETAG }]);
  assert.deepEqual(fs.readFileSync(destination), FILE_BYTES);
  assert.equal(fs.existsSync(`${destination}.partial`), false);
});

test('a changed ETag discards the partial file and downloads the new file from the start', async t => {
  const { targetPath, destination } = preparePartial('huggingface--changed');
  const updated = Buffer.from('ZYXWVUTSRQPONMLKJIHG');
  const cdn = fakeCdn(updated, '"sha256-of-new-model"');
  const originalFetch = global.fetch;
  global.fetch = cdn.fetch;
  t.after(() => { global.fetch = originalFetch; });

  const db = downloadsDatabase();
  insertDownload(db, { id: 'changed-1', status: 'failed', targetPath });
  const library = new ModelLibraryService(db);
  library.scanDownloadedModels = async () => [];

  library.resumeDownload('changed-1');
  await waitForStatus(library, 'changed-1', 'completed');

  assert.deepEqual(cdn.requests, [
    { range: 'bytes=8-', ifRange: ETAG },
    { range: undefined, ifRange: undefined },
  ]);
  assert.deepEqual(fs.readFileSync(destination), updated);
  assert.equal(storedEtag(db, 'changed-1'), '"sha256-of-new-model"');
});

test('a partial file without a stored ETag is downloaded again from the start', async t => {
  const { targetPath, destination } = preparePartial('huggingface--legacy');
  const cdn = fakeCdn(FILE_BYTES, ETAG);
  const originalFetch = global.fetch;
  global.fetch = cdn.fetch;
  t.after(() => { global.fetch = originalFetch; });

  const db = downloadsDatabase();
  insertDownload(db, { id: 'legacy-1', status: 'failed', targetPath, etag: null });
  const library = new ModelLibraryService(db);
  library.scanDownloadedModels = async () => [];

  library.resumeDownload('legacy-1');
  await waitForStatus(library, 'legacy-1', 'completed');

  assert.deepEqual(cdn.requests, [{ range: undefined, ifRange: undefined }]);
  assert.deepEqual(fs.readFileSync(destination), FILE_BYTES);
  assert.equal(storedEtag(db, 'legacy-1'), ETAG);
});

test('resume decisions validate the range start, total size, and ETag', () => {
  const partial = (contentRange, etag = ETAG, status = 206) => ({ status, contentRange, etag });
  assert.equal(downloadResumeDecision(8, ETAG, 20, partial('bytes 8-19/20')), 'append');
  assert.equal(downloadResumeDecision(8, ETAG, 20, partial('bytes 8-19/20', null)), 'append');
  assert.equal(downloadResumeDecision(8, ETAG, 20, partial('bytes 8-19/20', '"other"')), 'restart');
  assert.equal(downloadResumeDecision(8, ETAG, 20, partial('bytes 0-19/20')), 'restart');
  assert.equal(downloadResumeDecision(8, ETAG, 20, partial('bytes 8-29/30')), 'restart');
  assert.equal(downloadResumeDecision(8, ETAG, 20, partial(null, null, 206)), 'restart');
  // A server that ignores Range or rejects If-Range sends the whole file with 200.
  assert.equal(downloadResumeDecision(8, ETAG, 20, partial(null, '"other"', 200)), 'fresh');
  assert.equal(downloadResumeDecision(0, null, 20, partial(null, ETAG, 200)), 'fresh');
  // ModelScope can label a whole-file 200 response with a Content-Range.
  assert.equal(downloadResumeDecision(0, null, 659, partial('bytes 0-658/659', null, 200)), 'fresh');
  assert.equal(downloadResumeDecision(0, null, 20, partial('bytes 0-9/20')), 'invalid');
});

test('deleting an unfinished download removes the partial file, empty folders, and the row', () => {
  const targetPath = path.join(defaultManagedModelDirectory(), 'huggingface--delete');
  const destination = path.join(targetPath, 'nested', 'model.gguf');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(`${destination}.partial`, FILE_BYTES.subarray(0, 8));

  const db = downloadsDatabase();
  insertDownload(db, { id: 'delete-1', status: 'cancelled', targetPath });
  const library = new ModelLibraryService(db);

  library.deleteDownload('delete-1');

  assert.equal(fs.existsSync(targetPath), false);
  assert.deepEqual(library.listDownloads(), []);
});

test('deleting a download keeps sibling files that other downloads own', () => {
  const targetPath = path.join(defaultManagedModelDirectory(), 'huggingface--siblings');
  const destination = path.join(targetPath, 'nested', 'model.gguf');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(`${destination}.partial`, FILE_BYTES.subarray(0, 8));
  fs.writeFileSync(path.join(targetPath, 'mmproj.gguf'), FILE_BYTES);

  const db = downloadsDatabase();
  insertDownload(db, { id: 'delete-2', status: 'failed', targetPath });
  new ModelLibraryService(db).deleteDownload('delete-2');

  assert.equal(fs.existsSync(path.join(targetPath, 'nested')), false);
  assert.equal(fs.existsSync(path.join(targetPath, 'mmproj.gguf')), true);
});

test('downloads outside the managed directory are never deleted from disk', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'tiginal-outside-'));
  const db = downloadsDatabase();
  insertDownload(db, { id: 'outside-1', status: 'failed', targetPath: outside });
  assert.throws(() => new ModelLibraryService(db).deleteDownload('outside-1'), /outside the managed model directory/);
  assert.equal(fs.existsSync(outside), true);
  fs.rmSync(outside, { recursive: true, force: true });
});

const SHA = '86d1098305f8acf2f025d6c4359640fb657ec491';

function marketModel(repoId, revision) {
  return {
    id: `huggingface:${repoId}:${revision}`,
    name: repoId.split('/')[1],
    author: repoId.split('/')[0],
    source: 'huggingface',
    repoId,
    revision,
    updatedAt: null,
    downloads: null,
    likes: null,
    license: null,
    formats: ['gguf'],
    capabilities: ['translation'],
    favorite: false,
    featured: true,
    sourceUrl: `https://huggingface.co/${repoId}`,
  };
}

// Answers the revision lookup, the file tree, and file downloads like huggingface.co.
function fakeHub() {
  const urls = [];
  const fetch = async url => {
    urls.push(url);
    if (url.includes('/revision/')) return Response.json({ sha: SHA });
    if (url.includes('/tree/')) return Response.json([{ type: 'file', path: 'model.gguf', size: FILE_BYTES.length }]);
    return new Response(FILE_BYTES, { status: 200, headers: { etag: '"file"' } });
  };
  return { fetch, urls };
}

test('download folders shorten a commit SHA to 7 characters and keep other revisions readable', () => {
  assert.equal(
    downloadDirectoryName({ source: 'huggingface', repoId: 'netease-youdao/Confucius4-T3PO-GGUF', revision: SHA }),
    'huggingface--netease-youdao--Confucius4-T3PO-GGUF--86d1098',
  );
  assert.equal(
    downloadDirectoryName({ source: 'modelscope', repoId: 'Qwen/Qwen2.5', revision: 'master' }),
    'modelscope--Qwen--Qwen2.5--master',
  );
});

test('details and downloads pin a branch to its commit and use the short folder name', async t => {
  const hub = fakeHub();
  const originalFetch = global.fetch;
  global.fetch = hub.fetch;
  t.after(() => { global.fetch = originalFetch; });

  const db = downloadsDatabase();
  const library = new ModelLibraryService(db);
  library.scanDownloadedModels = async () => [];
  const model = marketModel('netease-youdao/Confucius4-T3PO-GGUF', 'main');

  const details = await library.getDetails(model);
  assert.equal(details.revision, SHA);
  assert.equal(details.id, model.id);
  assert.equal(hub.urls.some(url => url.includes(`/tree/${SHA}`)), true);

  const download = await library.startDownload({ model, file: details.files[0] });
  assert.equal(download.revision, SHA);
  assert.equal(download.targetPath, path.join(defaultManagedModelDirectory(), 'huggingface--netease-youdao--Confucius4-T3PO-GGUF--86d1098'));
  await waitForStatus(library, download.id, 'completed');
  assert.equal(hub.urls.at(-1), `https://huggingface.co/netease-youdao/Confucius4-T3PO-GGUF/resolve/${SHA}/model.gguf`);
});

test('downloads keep using an existing folder named with the full commit SHA', async t => {
  const hub = fakeHub();
  const originalFetch = global.fetch;
  global.fetch = hub.fetch;
  t.after(() => { global.fetch = originalFetch; });

  const repoId = 'netease-youdao/Confucius4-R2T2-GGUF';
  const legacy = path.join(defaultManagedModelDirectory(), `huggingface--netease-youdao--Confucius4-R2T2-GGUF--${SHA}`);
  fs.mkdirSync(legacy, { recursive: true });

  const library = new ModelLibraryService(downloadsDatabase());
  library.scanDownloadedModels = async () => [];
  const download = await library.startDownload({
    model: marketModel(repoId, SHA),
    file: { path: 'model.gguf', sizeBytes: FILE_BYTES.length },
  });
  assert.equal(download.targetPath, legacy);
  await waitForStatus(library, download.id, 'completed');
  assert.equal(hub.urls.some(url => url.includes('/revision/')), false);
});
