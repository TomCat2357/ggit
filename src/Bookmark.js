/**
 * Bookmark.js — bookmark（設定/移動/削除）と goto（現在地の移動）。
 *
 * Jujutsu 流モデル: 現在地 working はコミットID（匿名ヘッド @）。ブックマークは手動で付ける
 * 名前付きポインタで、commit では自動前進しない（明示的に set/move したときだけ動く）。
 * 作業コピーはアクティブタブ1枚で、goto はその本文をその場で対象コミットの内容に入れ替える
 * （GAS のタブ生成・別インスタンス書き込み・アクティブタブ切替の制約を回避する。付録B/C）。
 */

/**
 * ブックマークを設定/移動する（git branch -f 相当・jj bookmark set）。
 * commitId 既定＝現在地 working。既存同名は移動になる。設定後の { name, commitId } を返す。
 */
function Ggit_bookmarkSet(name, commitId) {
  name = (name || '').trim();
  if (!name) throw new Error('ブックマーク名が空です。');
  if (name === GGIT_META_TITLE) {
    throw new Error('「' + GGIT_META_TITLE + '」は予約名です。別の名前を指定してください。');
  }

  var doc = DocumentApp.getActiveDocument();
  var store = Ggit_storeLoad(doc);

  var target = commitId || Ggit_resolveWorking(doc, store);
  if (!target) {
    throw new Error('指す先のコミットがありません。先にコミットしてください。');
  }
  if (!store.objects.hasOwnProperty(target)) {
    throw new Error('コミットが見つかりません: ' + target);
  }

  store.bookmarks[name] = target;
  Ggit_storeSave(doc, store);
  return { name: name, commitId: target };
}

/** ブックマークを削除する（git branch -d 相当）。戻り値: { name, deleted }。 */
function Ggit_bookmarkDelete(name) {
  name = (name || '').trim();
  var doc = DocumentApp.getActiveDocument();
  var store = Ggit_storeLoad(doc);
  if (!store.bookmarks.hasOwnProperty(name)) {
    throw new Error('ブックマークが見つかりません: ' + name);
  }
  delete store.bookmarks[name];
  Ggit_storeSave(doc, store);
  return { name: name, deleted: true };
}

/** 全ブックマークを {name, commitId} の配列で返す。 */
function Ggit_bookmarkList() {
  var doc = DocumentApp.getActiveDocument();
  var store = Ggit_storeLoad(doc);
  var out = [];
  for (var name in store.bookmarks) {
    if (store.bookmarks.hasOwnProperty(name)) out.push({ name: name, commitId: store.bookmarks[name] });
  }
  return out;
}

/**
 * 現在地 working を target（ブックマーク名 または コミットID）へ移動する（jj edit / git checkout 相当）。
 * 作業タブ本文を対象コミットの内容（テキスト＋書式）で置き換え、置き換えで失われる未コミット内容は
 * スタッシュ（仮コミット）へ退避する。戻り値: { target, commitId, stashed }。
 */
function Ggit_goto(target) {
  var doc = DocumentApp.getActiveDocument();
  var tab = doc.getActiveTab();

  var meta = Ggit_metaTab(doc);
  if (meta && tab.getId() === meta.getId()) {
    throw new Error('.vcs メタタブ上では移動できません。対象のタブを選択してください。');
  }

  var store = Ggit_storeLoad(doc);

  // target をコミットIDへ解決（ブランチ名優先、無ければコミットIDとみなす）。
  var commitId = store.bookmarks.hasOwnProperty(target) ? store.bookmarks[target] : target;
  if (!store.objects.hasOwnProperty(commitId)) {
    throw new Error('移動先が見つかりません: ' + target);
  }
  // スタッシュは DAG の葉（退避ポケット）であり、その上に履歴を積めない。@ をスタッシュへ
  // 乗せるとそこでコミットした実コミットがスタッシュを親に持ち、破棄時に孤立する。
  // よってスタッシュへの移動は禁止し、内容が欲しければ pop、不要なら破棄へ誘導する。
  if (store.objects[commitId].stash) {
    throw new Error(
      'スタッシュへは移動できません。スタッシュ一覧の「戻す(pop)」で内容を取り込むか、' +
      '「破棄」してください。');
  }

  var cur = Ggit_resolveWorking(doc, store);
  var targetSnap = Ggit_materialize(store, commitId);
  var curSnap = Ggit_serializeTab(tab);

  var stashed = false;
  if (curSnap !== targetSnap) {
    // 現在の未コミット内容を退避してから対象コミットの内容を復元する。
    stashed = Ggit_stashIfNeeded(
      store, tab, cur, curSnap,
      '移動前の自動スタッシュ' + (cur ? '（' + cur + '）' : ''));
    Ggit_restoreTab(tab, targetSnap); // テキスト＋書式ごと入れ替え
  }
  store.working = commitId;
  Ggit_storeSave(doc, store);
  return { target: target, commitId: commitId, stashed: stashed };
}
