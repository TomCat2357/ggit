/**
 * Merge.js — 3-way マージ（行単位 diff3）と衝突マーカー書き戻し。
 *
 * 設計仕様書 §7.2: 共通祖先（マージベース）を基準に3-wayマージを行い、衝突箇所には
 * Git 同様のマーカー（<<<<<<< / ======= / >>>>>>>）を本文へ書き戻す。
 *
 * 本実装は行単位の diff3 を採用する。共通祖先 O、現在のタブ（ours）A、マージ元（theirs）B を
 * 行配列に分解し、O に対する A/B の対応（LCS）から安定領域と変化領域を切り出してマージする。
 * diff-match-patch は差分の表示・パッチ生成（Snapshot 側）で用い、行単位の合流ロジックは
 * 純粋関数として本ファイルに実装する（ローカルでも単体検証可能）。
 */

/** 衝突マーカー。 */
var GGIT_CONFLICT_BEGIN = '<<<<<<< current';
var GGIT_CONFLICT_SEP = '=======';
var GGIT_CONFLICT_END = '>>>>>>> source';

/** 行分割（空文字は空配列に）。 */
function Ggit_splitLines(t) {
  return t.length ? t.split('\n') : [];
}

/** 行配列の一致判定。 */
function Ggit_arrEq(a, b) {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * 最長共通部分列（LCS）の一致ペア [aIndex, bIndex] を昇順で返す。
 * 行数規模（数百行程度）を想定した O(n*m) DP。
 */
function Ggit_lcsPairs(a, b) {
  var n = a.length, m = b.length;
  var dp = [];
  for (var i = 0; i <= n; i++) {
    dp[i] = [];
    for (var j = 0; j <= m; j++) dp[i][j] = 0;
  }
  for (var i2 = n - 1; i2 >= 0; i2--) {
    for (var j2 = m - 1; j2 >= 0; j2--) {
      dp[i2][j2] = (a[i2] === b[j2])
        ? dp[i2 + 1][j2 + 1] + 1
        : Math.max(dp[i2 + 1][j2], dp[i2][j2 + 1]);
    }
  }
  var pairs = [];
  var i3 = 0, j3 = 0;
  while (i3 < n && j3 < m) {
    if (a[i3] === b[j3]) {
      pairs.push([i3, j3]);
      i3++; j3++;
    } else if (dp[i3 + 1][j3] >= dp[i3][j3 + 1]) {
      i3++;
    } else {
      j3++;
    }
  }
  return pairs;
}

/**
 * 行単位 3-way マージ。{ text, conflict } を返す。
 *  oLines: 共通祖先 / aLines: ours（現在のタブ） / bLines: theirs（マージ元）
 */
function Ggit_diff3(oLines, aLines, bLines) {
  var oa = Ggit_lcsPairs(oLines, aLines);
  var ob = Ggit_lcsPairs(oLines, bLines);
  var oToA = {}, oToB = {};
  oa.forEach(function (p) { oToA[p[0]] = p[1]; });
  ob.forEach(function (p) { oToB[p[0]] = p[1]; });

  // O のうち A・B 双方で一致した行＝安定アンカー。LCS の単調性により順序整合する。
  var anchors = [];
  for (var k = 0; k < oLines.length; k++) {
    if (oToA.hasOwnProperty(k) && oToB.hasOwnProperty(k)) anchors.push(k);
  }

  var out = [];
  var conflict = false;
  var oPrev = 0, aPrev = 0, bPrev = 0;

  function emitRegion(oLo, oHi, aLo, aHi, bLo, bHi) {
    var oSlice = oLines.slice(oLo, oHi);
    var aSlice = aLines.slice(aLo, aHi);
    var bSlice = bLines.slice(bLo, bHi);
    if (Ggit_arrEq(aSlice, oSlice)) {
      // ours 不変 → theirs を採用
      Array.prototype.push.apply(out, bSlice);
    } else if (Ggit_arrEq(bSlice, oSlice)) {
      // theirs 不変 → ours を採用
      Array.prototype.push.apply(out, aSlice);
    } else if (Ggit_arrEq(aSlice, bSlice)) {
      // 両者が同一変更 → どちらでも可
      Array.prototype.push.apply(out, aSlice);
    } else {
      // 競合
      conflict = true;
      out.push(GGIT_CONFLICT_BEGIN);
      Array.prototype.push.apply(out, aSlice);
      out.push(GGIT_CONFLICT_SEP);
      Array.prototype.push.apply(out, bSlice);
      out.push(GGIT_CONFLICT_END);
    }
  }

  for (var idx = 0; idx < anchors.length; idx++) {
    var key = anchors[idx];
    var aK = oToA[key], bK = oToB[key];
    emitRegion(oPrev, key, aPrev, aK, bPrev, bK);
    out.push(oLines[key]); // アンカー行（三者共通）
    oPrev = key + 1; aPrev = aK + 1; bPrev = bK + 1;
  }
  emitRegion(oPrev, oLines.length, aPrev, aLines.length, bPrev, bLines.length);

  return { text: out.join('\n'), conflict: conflict };
}

/** id の全祖先（自身含む）を parent/parent2 で辿った集合。 */
function Ggit_ancestorSet(store, id) {
  var seen = {};
  var stack = [id];
  while (stack.length) {
    var c = stack.pop();
    if (!c || seen[c]) continue;
    var o = store.objects[c];
    if (!o) continue;
    seen[c] = true;
    if (o.parent) stack.push(o.parent);
    if (o.parent2) stack.push(o.parent2);
  }
  return seen;
}

/** idA・idB の最近共通祖先（BFS で最初に交差したノード）。無ければ null。 */
function Ggit_findLCA(store, idA, idB) {
  var ancA = Ggit_ancestorSet(store, idA);
  var seen = {};
  var queue = [idB];
  while (queue.length) {
    var c = queue.shift();
    if (!c || seen[c]) continue;
    seen[c] = true;
    if (ancA[c]) return c;
    var o = store.objects[c];
    if (!o) continue;
    if (o.parent) queue.push(o.parent);
    if (o.parent2) queue.push(o.parent2);
  }
  return null;
}

/**
 * source（ブックマーク名 または コミットID）を現在地 working（作業タブ）へ 3-way マージする。
 * 結果（マージ後本文）を作業タブへ書き戻し、
 * { conflict, commitId, upToDate, fastForward, stashed } を返す。
 *  - upToDate : マージ元が既に取り込み済み（変更なし）。
 *  - fastForward : 現在地が マージ元の祖先 → コミットを作らず working を進める。
 *  - 競合が無い分岐合流 → parent2 付きのマージコミットを記録し working を進める。
 *  - 競合時 → マーカー入り本文を書き戻し、コミットは作らず手動解決に委ねる。
 * jj 同様、いずれもブックマークは動かさない（working＝現在地のみ移動）。
 */
function Ggit_merge(source) {
  var doc = DocumentApp.getActiveDocument();
  var tab = doc.getActiveTab();
  var tabId = tab.getId();

  var meta = Ggit_metaTab(doc);
  if (meta && tabId === meta.getId()) {
    throw new Error('.vcs メタタブ上ではマージできません。対象のタブを選択してください。');
  }

  var store = Ggit_storeLoad(doc);
  var curHead = Ggit_resolveWorking(doc, store);
  if (!curHead) throw new Error('現在地に履歴がありません。先にコミットしてください。');

  // source をコミットIDへ解決（ブックマーク名優先）。
  var srcHead = store.bookmarks.hasOwnProperty(source) ? store.bookmarks[source] : source;
  if (!store.objects.hasOwnProperty(srcHead)) {
    throw new Error('マージ元が見つかりません: ' + source);
  }
  if (srcHead === curHead) throw new Error('現在地自身はマージできません。');

  var lca = Ggit_findLCA(store, curHead, srcHead);

  // マージ元が既に現在の祖先に含まれる（取り込み済み）。
  if (lca === srcHead) {
    return { conflict: false, commitId: null, upToDate: true, fastForward: false, stashed: false };
  }

  // 早送り（fast-forward）: 現在地が マージ元の祖先 なら、コミットを作らず working を進める。
  if (lca === curHead) {
    var curSnapNow = Ggit_serializeTab(tab);
    var ffStashed = Ggit_stashIfNeeded(
      store, tab, curHead, curSnapNow, 'マージ（早送り）前の自動スタッシュ');
    Ggit_restoreTab(tab, Ggit_materialize(store, srcHead)); // テキスト＋書式ごと取り込む
    store.working = srcHead;
    Ggit_storeSave(doc, store);
    return { conflict: false, commitId: srcHead, upToDate: false, fastForward: true, stashed: ffStashed };
  }

  // 3-way マージはプレーンテキスト対象（設計仕様書 §7.3）。スナップショットから text を射影する。
  var baseText = lca ? Ggit_plainOf(Ggit_materialize(store, lca)) : '';
  var srcText = Ggit_plainOf(Ggit_materialize(store, srcHead));
  var curText = Ggit_tabText(tab); // 作業中本文（未コミット編集も取り込む）

  var merged = Ggit_diff3(
    Ggit_splitLines(baseText), Ggit_splitLines(curText), Ggit_splitLines(srcText));
  Ggit_setTabText(tab, merged.text);

  if (merged.conflict) {
    return { conflict: true, commitId: null, upToDate: false, fastForward: false, stashed: false };
  }

  // クリーンマージ → parent2 付きマージコミットを記録。
  // 合流結果（プレーン）を書き戻した後のタブをシリアライズし、全コミットを
  // 同一のスナップショット表現で統一する（移動整合判定・後続 commit の比較が安定）。
  var ts = Ggit_timestamp();
  var srcLabel = store.bookmarks.hasOwnProperty(source) ? source : srcHead;
  var msg = 'Merge ' + srcLabel + ' into ' + curHead;
  var snap = Ggit_serializeTab(tab);
  var id = Ggit_commitId(store, curHead, ts, snap);
  store.objects[id] = {
    id: id,
    parent: curHead,
    parent2: srcHead,
    message: msg,
    author: Ggit_author(),
    timestamp: ts,
    payload: Ggit_makePayload(store, curHead, snap)
  };
  store.working = id;
  Ggit_storeSave(doc, store);
  return { conflict: false, commitId: id, upToDate: false, fastForward: false, stashed: false };
}
