/**
 * Stash.js — スタッシュ（＝stash:true 付きの仮コミット）。
 *
 * 要望1: スタッシュは DAG の外ではなく、objects 内の「コミットだけどスタッシュだと分かる」
 * stash:true 付きコミットとして記録する。goto / 復元で上書きされて失われる未コミット内容を、
 * その時点の現在地 working を親とする仮コミットへ退避する（git stash 相当）。
 *
 * 「そこに戻ったらスタッシュを消す」= pop（Ggit_popStash）: スタッシュ内容を作業タブへ戻し、
 * working をスタッシュの親へ移してから、その仮コミットを objects から削除する。
 */

/** スタッシュID（親＋timestamp＋本文の SHA-256 短縮）。 */
function Ggit_stashId(parentId, timestamp, snap) {
  return Ggit_sha256Hex((parentId || '') + '\n' + timestamp + '\n' + snap).substring(0, 8);
}

/**
 * 現在のスナップショット curSnap を必要ならスタッシュ（仮コミット）へ退避する。
 * 退避した場合 true。内容（テキスト）が履歴上のいずれかのコミット/スタッシュと
 * 同一なら false（既に保存済みで上書きしても失われないため）。
 * 同一判定はテキストベース: 書式のみの差は「同じ内容」とみなして退避しない。
 * parentId は退避元の現在地 working（仮コミットの親・pop で戻る先）。
 * store は破壊的に更新するが保存は呼び出し側で行う。
 */
function Ggit_stashIfNeeded(store, tab, parentId, curSnap, message) {
  // 内容（テキスト）が履歴上のいずれかのコミット/スタッシュと同一なら、既に保存済みで
  // 上書きしても失われないため退避不要（現在地コミットも含めて走査する）。
  // 比較はテキストベース（Ggit_plainOf）: 書式のみ異なる場合は同一とみなす。
  var curText = Ggit_plainOf(curSnap);
  for (var k in store.objects) {
    if (!store.objects.hasOwnProperty(k)) continue;
    if (Ggit_plainOf(Ggit_materialize(store, k)) === curText) return false;
  }

  var ts = Ggit_timestamp();
  var id = Ggit_stashId(parentId, ts, curSnap);
  while (store.objects.hasOwnProperty(id)) id = id + 'x';
  store.objects[id] = {
    id: id,
    parent: parentId || null,
    parent2: null,
    message: message || '自動スタッシュ（復元前）',
    author: Ggit_author(),
    timestamp: ts,
    payload: Ggit_makePayload(store, parentId, curSnap),
    stash: true
  };
  return true;
}

/** objects 内のスタッシュ（stash:true）を新しい順に一覧する。 */
function Ggit_listStashes(store) {
  var out = [];
  for (var k in store.objects) {
    if (!store.objects.hasOwnProperty(k)) continue;
    var o = store.objects[k];
    if (o.stash) out.push({ id: o.id, message: o.message, timestamp: o.timestamp, parent: o.parent });
  }
  out.sort(function (a, b) {
    var ta = a.timestamp || '', tb = b.timestamp || '';
    if (ta !== tb) return ta < tb ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });
  return out;
}

/**
 * スタッシュを作業タブへ戻して消す（git stash pop 相当・要望「戻ったら消す」）。
 * 戻す前の未コミット内容は再び退避する。
 * 戻り値: { stashId, stashed, popped }。
 */
function Ggit_popStash(stashId) {
  var doc = DocumentApp.getActiveDocument();
  var tab = doc.getActiveTab();

  var meta = Ggit_metaTab(doc);
  if (meta && tab.getId() === meta.getId()) {
    throw new Error('.vcs メタタブには適用できません。対象のタブを選択してください。');
  }

  var store = Ggit_storeLoad(doc);
  var st = store.objects[stashId];
  if (!st || !st.stash) throw new Error('スタッシュが見つかりません: ' + stashId);

  var snap = Ggit_materialize(store, stashId);
  var curSnap = Ggit_serializeTab(tab);
  var cur = Ggit_resolveWorking(doc, store);

  var stashed = false;
  if (Ggit_plainOf(curSnap) !== Ggit_plainOf(snap)) {
    stashed = Ggit_stashIfNeeded(store, tab, cur, curSnap, 'pop 前の自動スタッシュ');
    Ggit_restoreTab(tab, snap);
  }
  // スタッシュ内容が作業タブへ戻ったので、現在地はスタッシュの親（分岐元）へ。仮コミットは削除。
  store.working = st.parent || null;
  Ggit_spliceOutObject_(store, stashId);
  Ggit_storeSave(doc, store);
  return { stashId: stashId, stashed: stashed, popped: true };
}

/** スタッシュ（仮コミット）を破棄する（git stash drop 相当）。戻り値: { stashId, dropped }。 */
function Ggit_dropStash(stashId) {
  var doc = DocumentApp.getActiveDocument();
  var store = Ggit_storeLoad(doc);
  var st = store.objects[stashId];
  if (!st || !st.stash) throw new Error('スタッシュが見つかりません: ' + stashId);
  Ggit_spliceOutObject_(store, stashId);
  Ggit_storeSave(doc, store);
  return { stashId: stashId, dropped: true };
}

/**
 * オブジェクト id を DAG から安全に取り除く（splice）。単純な delete と異なり、
 * id を親に持つ子（parent==id）を id の親へ繋ぎ直し、その payload を新親基準で作り直す。
 * payload は親との delta で保存され得るため、基準（親）を消すと子が復元不能になる。これを防ぐ。
 *
 * 注: 削除前に子本文を materialize するため id 本体はこの時点でまだ存在している必要がある
 *     （本関数の末尾で初めて delete する）。parent2（マージ第2親）が id を指す場合も繋ぎ直す。
 *
 * 通常フロー（Ggit_goto のスタッシュ移動禁止）下ではスタッシュに子は付かないが、
 * 移行データ・マージ・将来の操作に対する不変条件として常に整合を保つ。
 */
function Ggit_spliceOutObject_(store, id) {
  var victim = store.objects[id];
  if (!victim) return;
  var newParent = victim.parent || null; // スタッシュ等の親（実コミット or null）

  for (var cid in store.objects) {
    if (!store.objects.hasOwnProperty(cid)) continue;
    if (cid === id) continue;
    var c = store.objects[cid];
    if (c.parent === id) {
      var text = Ggit_materialize(store, cid);            // victim 健在のうちに本文を確定
      c.parent = newParent;
      c.payload = Ggit_makePayload(store, newParent, text); // 新親基準で payload を再生成
    }
    if (c.parent2 === id) {
      c.parent2 = newParent;                              // payload は第1親基準のため再生成不要
    }
  }
  delete store.objects[id];
}

/**
 * 壊れた履歴を復旧する（破棄済みスタッシュ等で親を失ったコミットの救済）。
 *
 * 背景: 旧バージョンはスタッシュへ @ を乗せたままコミットでき、そのスタッシュを破棄すると
 * 子コミットが親（差分の基準）を失い materialize できなくなった。本関数はそれを救済する。
 *
 * 方針:
 *  1) 現在地 @ が materialize できない（連鎖断裂）場合、いま開いているタブ本文を @ の内容として
 *     full payload で作り直す（@ の本文は作業タブに生きているため復元できる）。
 *  2) その他、親/第2親が欠落参照になっているオブジェクトは根（null）へ切り離す。delta 連鎖が
 *     壊れているものは本文を復元できないため、その旨を報告する。
 * 戻り値: { recoveredWorking, detached, lost:[id...] }。
 */
function Ggit_repairStore() {
  var doc = DocumentApp.getActiveDocument();
  var tab = doc.getActiveTab();
  var meta = Ggit_metaTab(doc);
  if (meta && tab.getId() === meta.getId()) {
    throw new Error('.vcs メタタブ上では実行できません。復旧したいタブを選択してください。');
  }

  var store = Ggit_storeLoad(doc);
  var report = { recoveredWorking: false, detached: 0, lost: [] };

  // 1) 現在地 @ が壊れていれば、作業タブ本文から full で再構築する。
  var working = store.working;
  if (working && store.objects.hasOwnProperty(working)) {
    var broken = false;
    try { Ggit_materialize(store, working); } catch (e) { broken = true; }
    if (broken) {
      var o = store.objects[working];
      o.parent = null;
      o.parent2 = null;
      o.payload = { type: 'full', data: Ggit_gzipB64(Ggit_serializeTab(tab)) };
      report.recoveredWorking = true;
    }
  }

  // 2) 残る欠落参照を根へ切り離す。
  for (var id in store.objects) {
    if (!store.objects.hasOwnProperty(id)) continue;
    var obj = store.objects[id];
    if (obj.parent && !store.objects.hasOwnProperty(obj.parent)) {
      if (obj.payload && obj.payload.type !== 'full') report.lost.push(id); // 本文復元不能
      obj.parent = null;
      report.detached++;
    }
    if (obj.parent2 && !store.objects.hasOwnProperty(obj.parent2)) {
      obj.parent2 = null;
      report.detached++;
    }
  }

  Ggit_storeSave(doc, store);
  return report;
}
