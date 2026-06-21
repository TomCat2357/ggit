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
  _test_canMaterialize();
  _test_reachable();
  _test_gcDisconnected();
  _test_abandon();
  _test_stashGuard();
  _test_firstNonStashAncestor();
  _test_tabBodyEndIndex();
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
  // payload は collectNodes の表示判定（materialize 可否）を満たすため full を与える。
  var FULL = { type: 'full', data: 'x' };
  var branch = {
    objects: {
      A: { id: 'A', parent: null, parent2: null, timestamp: '2026-06-01', payload: FULL },
      B: { id: 'B', parent: 'A', parent2: null, timestamp: '2026-06-02', payload: FULL },
      C: { id: 'C', parent: 'B', parent2: null, timestamp: '2026-06-03', payload: FULL },
      D: { id: 'D', parent: 'B', parent2: null, timestamp: '2026-06-04', payload: FULL }
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
      A: { id: 'A', parent: null, parent2: null, timestamp: '2026-06-01', payload: FULL },
      B: { id: 'B', parent: 'A', parent2: null, timestamp: '2026-06-02', payload: FULL },
      D: { id: 'D', parent: 'A', parent2: null, timestamp: '2026-06-03', payload: FULL },
      E: { id: 'E', parent: 'B', parent2: 'D', timestamp: '2026-06-04', payload: FULL }
    },
    working: 'E', bookmarks: {}
  };
  var ml = gline(merge);
  _ok('graph マージ: sprout 行 |\\ がある', ml.join('\n').indexOf('|\\') >= 0);
  _ok('graph マージ: collapse 行 |/ がある', ml.join('\n').indexOf('|/') >= 0);
}

/** Ggit_canMaterialize（純粋関数）: payload 連鎖が full に届くかで復元可否を判定。 */
function _test_canMaterialize() {
  var FULL = { type: 'full', data: 'x' };
  var DELTA = { type: 'delta', data: 'd' };
  var store = {
    objects: {
      A: { id: 'A', parent: null, payload: FULL },     // full → 可
      B: { id: 'B', parent: 'A', payload: DELTA },     // full 経由で可
      C: { id: 'C', parent: 'GONE', payload: DELTA },  // 親欠落 → 不可
      D: { id: 'D', parent: 'C', payload: DELTA },     // 壊れ連鎖の子 → 不可
      E: { id: 'E', parent: null, payload: DELTA }     // delta なのに親無し → 不可
    }
  };
  _ok('canMaterialize: full は可', Ggit_canMaterialize(store, 'A') === true);
  _ok('canMaterialize: full 経由 delta は可', Ggit_canMaterialize(store, 'B') === true);
  _ok('canMaterialize: 親欠落 delta は不可', Ggit_canMaterialize(store, 'C') === false);
  _ok('canMaterialize: 壊れ連鎖の子も不可', Ggit_canMaterialize(store, 'D') === false);
  _ok('canMaterialize: 親無し delta は不可', Ggit_canMaterialize(store, 'E') === false);
  _ok('canMaterialize: 不在IDは不可', Ggit_canMaterialize(store, 'NOPE') === false);
}

/**
 * Ggit_headIds / Ggit_reachableIds / Ggit_displayableIds / Ggit_collectNodes（純粋関数）:
 * 可視ヘッド（子を持たない非スタッシュコミット＝匿名ヘッド）が到達ルートに含まれ、commit→移動で
 * ブックマーク無しの葉を置き去りにしても孤立しない（消えない）ことを確認する。
 */
function _test_reachable() {
  var FULL = { type: 'full', data: 'x' };
  var store = {
    version: 3,
    objects: {
      A: { id: 'A', parent: null, parent2: null, timestamp: '2026-06-01', payload: FULL },
      B: { id: 'B', parent: 'A', parent2: null, timestamp: '2026-06-02', payload: FULL }, // @（葉）
      C: { id: 'C', parent: 'A', parent2: null, timestamp: '2026-06-03', payload: FULL }, // 別枝の途中
      D: { id: 'D', parent: 'C', parent2: null, timestamp: '2026-06-04', payload: FULL }, // 別枝の葉＝可視ヘッド
      S: { id: 'S', parent: 'B', parent2: null, timestamp: '2026-06-05', payload: FULL, stash: true }
    },
    working: 'B', bookmarks: {}
  };
  var h = Ggit_headIds(store);
  _ok('heads: 葉 B/D がヘッド', h.B && h.D);
  _ok('heads: 内部 A/C とスタッシュ S はヘッドでない', !h.A && !h.C && !h.S);

  var r = Ggit_reachableIds(store);
  _ok('reachable: @ とその祖先', r.A && r.B);
  _ok('reachable: スタッシュもルート', r.S);
  _ok('reachable: 可視ヘッド D 経由で C/D も到達可能', r.C && r.D); // 匿名ヘッドを保持

  var show = Ggit_displayableIds(store);
  _ok('displayable: 別枝も表示（孤立しない）', show.C && show.D);
  _ok('displayable: 到達可能は表示', show.A && show.B && show.S);

  var ids = Ggit_collectNodes(store).map(function (n) { return n.id; });
  _ok('collectNodes: 全コミット A,B,C,D,S を表示',
    ids.length === 5 && ids.indexOf('C') >= 0 && ids.indexOf('D') >= 0);

  // 現在地 @ を A へ移しても、葉 B/D は可視ヘッドとして残る（commit→移動でコミットが消えない）。
  store.working = 'A';
  var r2 = Ggit_reachableIds(store);
  _ok('reachable: @ を移動しても葉 B/D は残る', r2.A && r2.B && r2.C && r2.D);
  var ids2 = Ggit_collectNodes(store).map(function (n) { return n.id; });
  _ok('collectNodes: @ 移動後も全コミットを表示', ids2.indexOf('B') >= 0 && ids2.indexOf('D') >= 0);
}

/**
 * Ggit_gcDisconnectedInStore / Ggit_countDisconnected（純粋関数）:
 * 可視ヘッドの葉は孤立扱いにせず残し、掃除対象は「壊れ（復元不能）」のみ。現在地 @ は保護、
 * 宙ぶらりんの参照を整理することを確認。
 */
function _test_gcDisconnected() {
  var FULL = { type: 'full', data: 'x' };
  var DELTA = { type: 'delta', data: 'd' };
  var store = {
    version: 3,
    objects: {
      A: { id: 'A', parent: null, parent2: null, payload: FULL },      // 健全な根
      B: { id: 'B', parent: 'A', parent2: null, payload: FULL },      // 現在地 @（健全）
      LEAF: { id: 'LEAF', parent: 'A', parent2: null, payload: FULL }, // ブックマーク無しの葉＝可視ヘッド（残る）
      BRK: { id: 'BRK', parent: 'GONE', parent2: null, payload: DELTA } // 壊れ（bookmark 参照・復元不能）
    },
    working: 'B', bookmarks: { broken: 'BRK' }
  };
  var before = Ggit_countDisconnected(store);
  _ok('count: 孤立0・壊れ1（葉は孤立しない）', before.total === 1 && before.orphans === 0 && before.broken === 1);

  var r = Ggit_gcDisconnectedInStore(store);
  _ok('gc: 壊れ1件のみ削除', r.removed.length === 1 && r.orphans === 0 && r.broken === 1);
  _ok('gc: 健全/現在地/可視ヘッドの葉は残る', !!store.objects.A && !!store.objects.B && !!store.objects.LEAF);
  _ok('gc: 壊れは消える', !store.objects.BRK);
  _ok('gc: 宙ぶらりん bookmark 除去', !store.bookmarks.hasOwnProperty('broken'));
  _ok('gc: 現在地は健全', r.workingBroken === false);
  _ok('gc後: 掃除対象ゼロ', Ggit_countDisconnected(store).total === 0);

  // 現在地 @ 自体が壊れている場合は削除せず残し、workingBroken=true を報告する。
  var s2 = {
    version: 3,
    objects: { W: { id: 'W', parent: 'GONE', parent2: null, payload: DELTA } },
    working: 'W', bookmarks: {}
  };
  var r2 = Ggit_gcDisconnectedInStore(s2);
  _ok('gc: 壊れた現在地は削除しない', !!s2.objects.W && r2.removed.length === 0);
  _ok('gc: workingBroken=true を報告', r2.workingBroken === true);
}

/**
 * Ggit_abandonInStore（純粋関数）: 葉から分岐元まで枝を刈り、共有点・現在地 @・ブックマーク先・
 * スタッシュは残す。葉以外・現在地・スタッシュの破棄は拒否することを確認。
 */
function _test_abandon() {
  var FULL = { type: 'full', data: 'x' };

  // A → B → C（破棄対象の葉）、A → M（@・別枝）。C を破棄すると C と分岐専有の B が消え、共有点 A と @ は残る。
  var store = {
    version: 3,
    objects: {
      A: { id: 'A', parent: null, parent2: null, payload: FULL },
      B: { id: 'B', parent: 'A', parent2: null, payload: FULL },
      C: { id: 'C', parent: 'B', parent2: null, payload: FULL },
      M: { id: 'M', parent: 'A', parent2: null, payload: FULL }
    },
    working: 'M', bookmarks: {}
  };
  var r = Ggit_abandonInStore(store, 'C');
  _ok('abandon: 葉 C と分岐専有の B を刈る', r.removed.length === 2 && !store.objects.C && !store.objects.B);
  _ok('abandon: 分岐元 A（@ 側で共有）は残す', !!store.objects.A);
  _ok('abandon: 現在地 @ M は残る', !!store.objects.M);

  // ブックマークが枝の途中 B を指す場合、B で止まる（C のみ削除）。
  var store2 = {
    version: 3,
    objects: {
      A: { id: 'A', parent: null, parent2: null, payload: FULL },
      B: { id: 'B', parent: 'A', parent2: null, payload: FULL },
      C: { id: 'C', parent: 'B', parent2: null, payload: FULL }
    },
    working: 'A', bookmarks: { keep: 'B' }
  };
  var r2 = Ggit_abandonInStore(store2, 'C');
  _ok('abandon: ブックマーク先 B で止まる', r2.removed.length === 1 && !store2.objects.C && !!store2.objects.B);

  // 後続のあるコミット・現在地 @・スタッシュは破棄不可（拒否してオブジェクトは残る）。
  var store3 = {
    version: 3,
    objects: {
      A: { id: 'A', parent: null, parent2: null, payload: FULL },
      B: { id: 'B', parent: 'A', parent2: null, payload: FULL },
      S: { id: 'S', parent: 'A', parent2: null, payload: FULL, stash: true }
    },
    working: 'B', bookmarks: {}
  };
  var threwChild = false;
  try { Ggit_abandonInStore(store3, 'A'); } catch (e) { threwChild = true; }
  _ok('abandon: 後続のあるコミットは拒否', threwChild && !!store3.objects.A);
  var threwWorking = false;
  try { Ggit_abandonInStore(store3, 'B'); } catch (e) { threwWorking = true; }
  _ok('abandon: 現在地 @ は拒否', threwWorking && !!store3.objects.B);
  var threwStash = false;
  try { Ggit_abandonInStore(store3, 'S'); } catch (e) { threwStash = true; }
  _ok('abandon: スタッシュは拒否', threwStash && !!store3.objects.S);

  // スタッシュだけが乗った葉は破棄でき、付随スタッシュも一緒に消える（実枝が無いので拒否しない）。
  // A → B（葉。子はスタッシュ S のみ）、working=A。B を破棄すると B と S が消え、分岐元 A は残る。
  var store4 = {
    version: 3,
    objects: {
      A: { id: 'A', parent: null, parent2: null, payload: FULL },
      B: { id: 'B', parent: 'A', parent2: null, payload: FULL },
      S: { id: 'S', parent: 'B', parent2: null, payload: FULL, stash: true }
    },
    working: 'A', bookmarks: {}
  };
  var r4 = Ggit_abandonInStore(store4, 'B');
  _ok('abandon: スタッシュだけの葉 B は破棄できる', !store4.objects.B && r4.removed.length === 1);
  _ok('abandon: 付随スタッシュ S も一緒に破棄', !store4.objects.S && r4.droppedStashes.length === 1);
  _ok('abandon: 分岐元 A は残す', !!store4.objects.A);
}

/**
 * Ggit_tabBodyEndIndex_ が Docs.Documents.get レスポンス（モック）から、
 * トップ階層タブ・子タブそれぞれの本文末尾 endIndex を返すことを確認。
 * これは `.vcs` を Docs API で安全に書き戻す Ggit_setTabTextApi の前提となる純粋ロジック。
 */
function _test_tabBodyEndIndex() {
  var res = {
    tabs: [
      { tabProperties: { tabId: 't.parent' },
        documentTab: { body: { content: [{ endIndex: 1 }, { endIndex: 42 }] } },
        childTabs: [
          { tabProperties: { tabId: 't.child' },
            documentTab: { body: { content: [{ endIndex: 1 }, { endIndex: 7 }] } } }
        ] }
    ]
  };
  _ok('tabBodyEndIndex: トップ階層', Ggit_tabBodyEndIndex_(res, 't.parent') === 42);
  _ok('tabBodyEndIndex: 子タブ', Ggit_tabBodyEndIndex_(res, 't.child') === 7);
}

/**
 * Ggit_firstNonStashAncestor_ が、スタッシュ（stash:true）を飛ばして直近の実コミットを返し、
 * 連鎖が欠落していれば null を返すことを確認する（commit がスタッシュを親に取らない保証）。
 */
function _test_firstNonStashAncestor() {
  var store = {
    objects: {
      A: { id: 'A', parent: null, parent2: null },
      S: { id: 'S', parent: 'A', parent2: null, stash: true },
      S2: { id: 'S2', parent: 'S', parent2: null, stash: true },
      B: { id: 'B', parent: 'S', parent2: null }
    }
  };
  _ok('firstNonStashAncestor: スタッシュを飛ばし実祖先A', Ggit_firstNonStashAncestor_(store, 'S') === 'A');
  _ok('firstNonStashAncestor: 二段スタッシュもA', Ggit_firstNonStashAncestor_(store, 'S2') === 'A');
  _ok('firstNonStashAncestor: 実コミットは自身', Ggit_firstNonStashAncestor_(store, 'B') === 'B');
  _ok('firstNonStashAncestor: 連鎖欠落はnull',
    Ggit_firstNonStashAncestor_({ objects: { X: { id: 'X', parent: 'GONE', stash: true } } }, 'X') === null);
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
