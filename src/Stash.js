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
  if (curSnap !== snap) {
    stashed = Ggit_stashIfNeeded(store, tab, cur, curSnap, 'pop 前の自動スタッシュ');
    Ggit_restoreTab(tab, snap);
  }
  // スタッシュ内容が作業タブへ戻ったので、現在地はスタッシュの親（分岐元）へ。仮コミットは削除。
  store.working = st.parent || null;
  delete store.objects[stashId];
  Ggit_storeSave(doc, store);
  return { stashId: stashId, stashed: stashed, popped: true };
}

/** スタッシュ（仮コミット）を破棄する（git stash drop 相当）。戻り値: { stashId, dropped }。 */
function Ggit_dropStash(stashId) {
  var doc = DocumentApp.getActiveDocument();
  var store = Ggit_storeLoad(doc);
  var st = store.objects[stashId];
  if (!st || !st.stash) throw new Error('スタッシュが見つかりません: ' + stashId);
  delete store.objects[stashId];
  Ggit_storeSave(doc, store);
  return { stashId: stashId, dropped: true };
}
