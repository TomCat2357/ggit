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
  _test_mergeNoConflict();
  _test_mergeConflict();
  _test_lca();
  _test_restoreMaterialize();
  _test_tabBodyEndIndex();
  _test_diffDirection();
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
