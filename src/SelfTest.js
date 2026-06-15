/**
 * SelfTest.js — Apps Script エディタから手動実行する自己テスト。
 *
 * 実行方法: Apps Script エディタで関数を選択して実行し、実行ログ（Logger）を確認する。
 * `_test_all` を実行すると全テストを順に走らせる。
 *
 * 注: gzip / computeDigest などは GAS ランタイムが必要なため、これらはエディタ実行用。
 * 一方 diff3 / LCS / LCA は純粋関数で、ローカル（Node 等）でも検証できる。
 */

function _test_all() {
  _test_hash();
  _test_snapshotRoundTrip();
  _test_plainOf();
  _test_snapshotFormatString();
  _test_mergeNoConflict();
  _test_mergeConflict();
  _test_lca();
  _test_migrate();
  _test_graphLines();
  _test_stashGuard();
  Logger.log('--- self-test 完了 ---');
}

function _ok(name, cond) {
  Logger.log((cond ? 'PASS' : 'FAIL') + ': ' + name);
  if (!cond) throw new Error('FAILED: ' + name);
}

function _test_hash() {
  var store = { objects: {} };
  var a = Ggit_commitId(store, null, '2026-01-01T00:00:00+09:00', 'hello');
  var b = Ggit_commitId(store, null, '2026-01-01T00:00:00+09:00', 'hello');
  var c = Ggit_commitId(store, null, '2026-01-01T00:00:00+09:00', 'world');
  _ok('hash 同一入力で同一ID', a === b);
  _ok('hash 異入力で別ID', a !== c);
  _ok('hash 既定7桁', a.length === 7);
}

/** in-memory ストアに commit を積み、各コミット本文が復元できることを確認。 */
function _test_snapshotRoundTrip() {
  var store = { version: 1, objects: {}, branches: {} };
  var branch = 't.test';

  function commit(parent, text) {
    var ts = '2026-01-01T00:00:00+09:00';
    var id = Ggit_commitId(store, parent, ts + text, text);
    store.objects[id] = {
      id: id, parent: parent, parent2: null,
      message: 'm', author: 'x', timestamp: ts,
      payload: Ggit_makePayload(store, parent, text)
    };
    return id;
  }

  var texts = ['line1\nline2', 'line1\nline2\nline3', 'CHANGED1\nline2\nline3'];
  var ids = [];
  var parent = null;
  for (var i = 0; i < texts.length; i++) {
    var id = commit(parent, texts[i]);
    ids.push(id);
    parent = id;
  }
  for (var j = 0; j < ids.length; j++) {
    _ok('materialize[' + j + '] 一致', Ggit_materialize(store, ids[j]) === texts[j]);
  }

  // delta 連鎖がフル間隔を超えるとフルが挿入されることを確認。
  var t = 'x';
  var p = null;
  var lastId = null;
  for (var k = 0; k < GGIT_FULL_INTERVAL + 2; k++) {
    t = t + '\n' + k;
    lastId = commit(p, t);
    p = lastId;
  }
  _ok('長い連鎖でも復元一致', Ggit_materialize(store, lastId) === t);
}

/** Ggit_plainOf の新形式抽出と旧プレーン payload 後方互換（純粋関数）。 */
function _test_plainOf() {
  var newSnap = JSON.stringify({ v: 1, text: 'a\nb', fmt: { runs: [], paras: [] } });
  _ok('plainOf 新形式→text', Ggit_plainOf(newSnap) === 'a\nb');
  _ok('plainOf 旧プレーン互換', Ggit_plainOf('line1\nline2') === 'line1\nline2');
  _ok('plainOf 数値風プレーン', Ggit_plainOf('123') === '123');
  _ok('plainOf JSON風プレーン', Ggit_plainOf('{"a":1}') === '{"a":1}');
}

/**
 * payload パイプライン（makePayload/materialize）が書式付きスナップショット文字列でも
 * round-trip すること、および「テキスト同一・書式のみ差」が別スナップショットになることを確認。
 */
function _test_snapshotFormatString() {
  var store = { version: 1, objects: {}, branches: {} };
  var branch = 't.fmt';
  function commit(parent, snap) {
    var ts = '2026-01-01T00:00:00+09:00';
    var id = Ggit_commitId(store, parent, ts + snap, snap);
    store.objects[id] = {
      id: id, parent: parent, parent2: null,
      message: 'm', author: 'x', timestamp: ts,
      payload: Ggit_makePayload(store, parent, snap)
    };
    return id;
  }
  var snapA = JSON.stringify({ v: 1, text: 'hello\nworld', fmt: { runs: [{ s: 0, e: 4, a: { BOLD: true } }], paras: [{ i: 0, a: {} }] } });
  var snapB = JSON.stringify({ v: 1, text: 'hello\nworld', fmt: { runs: [{ s: 0, e: 4, a: { ITALIC: true } }], paras: [{ i: 0, a: {} }] } });

  var id1 = commit(null, snapA);
  var id2 = commit(id1, snapB);
  _ok('snapshot文字列 round-trip A', Ggit_materialize(store, id1) === snapA);
  _ok('snapshot文字列 round-trip B', Ggit_materialize(store, id2) === snapB);
  _ok('書式のみ差で別スナップショット', snapA !== snapB);
  _ok('plainOf は同一テキスト', Ggit_plainOf(snapA) === Ggit_plainOf(snapB));
}

function _test_mergeNoConflict() {
  var base = Ggit_splitLines('l1\nl2\nl3\nl4\nl5');
  var ours = Ggit_splitLines('l1\nOURS2\nl3\nl4\nl5');
  var theirs = Ggit_splitLines('l1\nl2\nl3\nTHEIRS4\nl5');
  var m = Ggit_diff3(base, ours, theirs);
  _ok('merge 競合なし', m.conflict === false);
  _ok('merge 双方の変更を統合', m.text === 'l1\nOURS2\nl3\nTHEIRS4\nl5');
}

function _test_mergeConflict() {
  var m = Ggit_diff3(
    Ggit_splitLines('x\ny\nz'),
    Ggit_splitLines('x\nMINE\nz'),
    Ggit_splitLines('x\nYOURS\nz'));
  _ok('merge 競合検出', m.conflict === true);
  _ok('merge 競合マーカー', m.text.indexOf('<<<<<<<') >= 0 && m.text.indexOf('>>>>>>>') >= 0);
}

/** 旧スキーマ（v1: tabId→{head,name} / v2: branches+head+stashes）→ v3（bookmarks+working）の移行。 */
function _test_migrate() {
  // v1 → v3: branches を name キー化し bookmarks へ。head 概念が無いので working は null。
  var old = {
    version: 1, objects: {}, stashes: [],
    branches: {
      't.aaa': { head: 'c1', name: 'メイン' },
      't.bbb': { head: 'c2', name: 'feature' }
    }
  };
  var s = Ggit_migrateStore(old);
  _ok('migrate version=3', s.version === 3);
  _ok('migrate bookmarks 名前キー化', s.bookmarks['メイン'] === 'c1' && s.bookmarks['feature'] === 'c2');
  _ok('migrate working 初期 null', s.working === null);
  _ok('migrate 旧キー削除', s.branches === undefined && s.head === undefined && s.stashes === undefined);

  // 同名タブは連番で一意化する。
  var dup = {
    version: 1, objects: {}, stashes: [],
    branches: { 't.1': { head: 'h1', name: 'X' }, 't.2': { head: 'h2', name: 'X' } }
  };
  var s2 = Ggit_migrateStore(dup);
  _ok('migrate 同名は一意化', s2.bookmarks['X'] === 'h1' && s2.bookmarks['X-2'] === 'h2');

  // v2 → v3: head→working、stashes[]→stash:true コミット。
  var v2 = {
    version: 2, objects: { c9: { id: 'c9', parent: null } },
    branches: { 'メイン': 'c9' }, head: 'メイン',
    stashes: [{ id: 'st01', branchName: 'メイン', timestamp: '2026-01-02T00:00:00+09:00', message: '退避', data: 'GZIP' }]
  };
  var s3 = Ggit_migrateStore(v2);
  _ok('migrate v2 bookmarks', s3.bookmarks['メイン'] === 'c9');
  _ok('migrate v2 head→working', s3.working === 'c9');
  _ok('migrate stash→コミット化', s3.objects['st01'] && s3.objects['st01'].stash === true &&
    s3.objects['st01'].parent === 'c9' && s3.objects['st01'].payload.data === 'GZIP');

  // 既に v3 のストアは不変。
  var nv = { version: 3, objects: {}, bookmarks: { 'メイン': 'c9' }, working: 'c9' };
  var s4 = Ggit_migrateStore(nv);
  _ok('migrate v3 は不変', s4.bookmarks['メイン'] === 'c9' && s4.working === 'c9');
}

/** ASCII レーングラフ（純粋関数）: 分岐・マージの形を検証。 */
function _test_graphLines() {
  // A→B→C と B→D の分岐。bookmark main→C、working=D。
  function gline(store) {
    return Ggit_graphLines(Ggit_collectNodes(store)).map(function (r) { return r.graph; });
  }
  var branch = {
    objects: {
      A: { id: 'A', parent: null, parent2: null, timestamp: '2026-06-01' },
      B: { id: 'B', parent: 'A', parent2: null, timestamp: '2026-06-02' },
      C: { id: 'C', parent: 'B', parent2: null, timestamp: '2026-06-03' },
      D: { id: 'D', parent: 'B', parent2: null, timestamp: '2026-06-04' }
    },
    working: 'D', bookmarks: { main: 'C' }
  };
  var bl = gline(branch);
  // 期待形: * (D) / | * (C) / |/ / *(B) / *(A)
  _ok('graph 分岐: collapse 行 |/ がある', bl.indexOf('|/ ') >= 0 || bl.indexOf('|/') >= 0);
  _ok('graph 分岐: 2レーン行 "| *" がある', bl.indexOf('| *') >= 0);
  _ok('graph 分岐: 行数=コミット4＋collapse1', bl.length === 5);

  // マージ: A→B、A→D、E が B と D を合流（parent2）。
  var merge = {
    objects: {
      A: { id: 'A', parent: null, parent2: null, timestamp: '2026-06-01' },
      B: { id: 'B', parent: 'A', parent2: null, timestamp: '2026-06-02' },
      D: { id: 'D', parent: 'A', parent2: null, timestamp: '2026-06-03' },
      E: { id: 'E', parent: 'B', parent2: 'D', timestamp: '2026-06-04' }
    },
    working: 'E', bookmarks: {}
  };
  var ml = gline(merge);
  _ok('graph マージ: sprout 行 |\\ がある', ml.join('\n').indexOf('|\\') >= 0);
  _ok('graph マージ: collapse 行 |/ がある', ml.join('\n').indexOf('|/') >= 0);
}

function _test_lca() {
  var store = {
    objects: {
      A: { id: 'A', parent: null, parent2: null },
      B: { id: 'B', parent: 'A', parent2: null },
      C: { id: 'C', parent: 'A', parent2: null },
      D: { id: 'D', parent: 'B', parent2: null }
    }
  };
  _ok('LCA(D,C)=A', Ggit_findLCA(store, 'D', 'C') === 'A');
  _ok('LCA(D,B)=B', Ggit_findLCA(store, 'D', 'B') === 'B');
}

/**
 * スタッシュの no-op ガード: 内容（テキスト）が履歴上のいずれかのコミット/スタッシュと
 * 同一なら退避（仮コミット作成）しないことを確認する（書式のみ差も同一扱い）。
 * 注: Ggit_stashIfNeeded の第2引数 tab は本体で未使用なので null を渡す。
 *     makePayload/materialize は GAS ランタイム依存のためエディタ実行用。
 */
function _test_stashGuard() {
  var store = { version: 3, objects: {}, bookmarks: {}, working: null };
  function commit(parent, snap) {
    var ts = '2026-01-01T00:00:00+09:00';
    var id = Ggit_commitId(store, parent, ts + snap, snap);
    store.objects[id] = {
      id: id, parent: parent, parent2: null,
      message: 'm', author: 'x', timestamp: ts,
      payload: Ggit_makePayload(store, parent, snap)
    };
    return id;
  }
  function snapOf(text) {
    return JSON.stringify({ v: 1, text: text, fmt: { runs: [], paras: [] } });
  }
  var snapA = snapOf('A'), snapB = snapOf('B'), snapC = snapOf('C');
  var a = commit(null, snapA);
  var b = commit(a, snapB);
  store.working = b;

  // 現在地コミット(b)と同一 → 作らない（従来どおり）。
  _ok('stash 現在地と同一は作らない', Ggit_stashIfNeeded(store, null, b, snapB, 'm') === false);
  // 現在地以外の既存コミット(a)と同一 → 作らない（今回の拡張点）。
  _ok('stash 任意コミットと同一は作らない', Ggit_stashIfNeeded(store, null, b, snapA, 'm') === false);
  // テキスト同一・書式のみ差 → 作らない（テキストベース比較）。
  var snapBfmt = JSON.stringify({ v: 1, text: 'B', fmt: { runs: [{ s: 0, e: 0, a: { BOLD: true } }], paras: [] } });
  _ok('stash 書式のみ差は作らない（テキスト基準）', Ggit_stashIfNeeded(store, null, b, snapBfmt, 'm') === false);

  // どのコミットとも異なる新規内容 → 作る。objects が1件増える。
  var before = 0;
  for (var k0 in store.objects) { if (store.objects.hasOwnProperty(k0)) before++; }
  _ok('stash 新規内容は作る', Ggit_stashIfNeeded(store, null, b, snapC, '退避') === true);
  var after = 0;
  for (var k1 in store.objects) { if (store.objects.hasOwnProperty(k1)) after++; }
  _ok('stash 作成で objects 増加', after === before + 1);

  // 直前で作ったスタッシュと同一内容 → 作らない（重複防止が維持）。
  _ok('stash 同一スタッシュは重複させない', Ggit_stashIfNeeded(store, null, b, snapC, '退避') === false);
}
