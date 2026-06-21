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
  _test_restoreMaterialize();
  _test_tabBodyEndIndex();
  _test_diffDirection();
  _test_pickStore();
  _test_backupChunkRoundTrip();
  Logger.log('--- self-test 完了 ---');
}

function _ok(name, cond) {
  Logger.log((cond ? 'PASS' : 'FAIL') + ': ' + name);
  if (!cond) throw new Error('FAILED: ' + name);
}

function _test_hash() {
  var store = { objects: {} };
  var a = Ggit_commitId(store, 't.1', null, '2026-01-01T00:00:00+09:00', 'hello');
  var b = Ggit_commitId(store, 't.1', null, '2026-01-01T00:00:00+09:00', 'hello');
  var c = Ggit_commitId(store, 't.1', null, '2026-01-01T00:00:00+09:00', 'world');
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
    var id = Ggit_commitId(store, branch, parent, ts + text, text);
    store.objects[id] = {
      id: id, branch: branch, parent: parent, parent2: null,
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
    var id = Ggit_commitId(store, branch, parent, ts + snap, snap);
    store.objects[id] = {
      id: id, branch: branch, parent: parent, parent2: null,
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

/**
 * preview / restore のデータ経路（Ggit_materialize）が各コミット本文を復元することを確認。
 * Ggit_previewCommit / Ggit_restoreCommit はこの結果をそのままタブへ書く。
 */
function _test_restoreMaterialize() {
  var store = { version: 1, objects: {}, branches: {} };
  var branch = 't.restore';
  var texts = ['v1\nbody', 'v1\nbody\nmore', 'v1-CHANGED\nbody\nmore'];
  var ids = [];
  var parent = null;
  for (var i = 0; i < texts.length; i++) {
    var ts = '2026-01-01T00:00:00+09:00';
    var id = Ggit_commitId(store, branch, parent, ts + texts[i], texts[i]);
    store.objects[id] = {
      id: id, branch: branch, parent: parent, parent2: null,
      message: 'm', author: 'x', timestamp: ts,
      payload: Ggit_makePayload(store, parent, texts[i])
    };
    ids.push(id);
    parent = id;
  }
  // 任意の過去コミットを「復元元」として正しい本文を取り出せること。
  _ok('restore: 旧版本文を復元', Ggit_materialize(store, ids[0]) === texts[0]);
  _ok('restore: 中間版本文を復元', Ggit_materialize(store, ids[1]) === texts[1]);
  _ok('restore: 最新版本文を復元', Ggit_materialize(store, ids[2]) === texts[2]);
}

/**
 * Ggit_tabBodyEndIndex_ が Docs.Documents.get レスポンス（モック）から、
 * トップ階層タブ・子タブそれぞれの本文末尾 endIndex を返すことを確認。
 */
function _test_tabBodyEndIndex() {
  var res = {
    tabs: [
      { tabId: 't.parent',
        documentTab: { body: { content: [{ endIndex: 1 }, { endIndex: 42 }] } },
        childTabs: [
          { tabId: 't.child',
            documentTab: { body: { content: [{ endIndex: 1 }, { endIndex: 7 }] } } }
        ] }
    ]
  };
  _ok('tabBodyEndIndex: トップ階層', Ggit_tabBodyEndIndex_(res, 't.parent') === 42);
  _ok('tabBodyEndIndex: 子タブ', Ggit_tabBodyEndIndex_(res, 't.child') === 7);
}

/**
 * Log のプレビュー差分は A=コミット, B=作業中。作業中で行を追加したとき、
 * 着色HTMLに挿入（ins）スパンが現れることを確認。
 */
function _test_diffDirection() {
  var committed = 'l1\nl2';
  var working = 'l1\nl2\nl3-added';
  var html = Ggit_diffHtml(committed, working);
  _ok('diff方向: 作業中の追加が ins として現れる', html.indexOf('<ins') >= 0);
}

/**
 * Ggit_pickStore の採用ロジック（純粋関数）。
 * 巻き戻し検知＝backup.gen > tab.gen で backup を採用することを中心に各分岐を検証。
 */
function _test_pickStore() {
  var tab = { version: 1, gen: 2, objects: { a: 1 }, branches: {} };
  var bk5 = { version: 1, gen: 5, objects: { a: 1, b: 1 }, branches: {} };
  var bk1 = { version: 1, gen: 1, objects: {}, branches: {} };

  _ok('pickStore: 巻き戻し検知で backup 採用', Ggit_pickStore(tab, bk5) === bk5);
  _ok('pickStore: タブが新しければ tab 採用', Ggit_pickStore(tab, bk1) === tab);
  _ok('pickStore: 同点はタブ優先', Ggit_pickStore({ gen: 3 }, { gen: 3 }).gen === 3 &&
    Ggit_pickStore(tab, { gen: 2, objects: {}, branches: {} }) === tab);
  _ok('pickStore: backup 欠落で tab 採用', Ggit_pickStore(tab, null) === tab);
  _ok('pickStore: tab 欠落で backup 採用', Ggit_pickStore(null, bk5) === bk5);
  _ok('pickStore: 両方欠落で空ストア', Ggit_pickStore(null, null).gen === 0);
}

/**
 * バックアップのチャンク分割→結合が原本一致すること（純粋関数）。
 * gzip 圧縮の往復は GAS ランタイムが必要なため別途（_test_snapshotRoundTrip 等）に委ね、
 * ここではチャンク化（Ggit_chunk）の分割/結合の正しさのみを検証する。
 */
function _test_backupChunkRoundTrip() {
  var big = '';
  for (var i = 0; i < 5000; i++) big += (i % 10);
  var chunks = Ggit_chunk(big, 8000);
  _ok('chunk: 分割数が想定どおり', chunks.length === 1);
  _ok('chunk: 結合で原本一致(小)', chunks.join('') === big);

  var chunks2 = Ggit_chunk(big, 700);
  _ok('chunk: 複数分割', chunks2.length === Math.ceil(big.length / 700));
  _ok('chunk: 各チャンクが上限以下', chunks2.every(function (c) { return c.length <= 700; }));
  _ok('chunk: 結合で原本一致(分割)', chunks2.join('') === big);
  _ok('chunk: 空文字は空配列', Ggit_chunk('', 700).length === 0);
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
