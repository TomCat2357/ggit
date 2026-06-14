/**
 * Commit.js — commit / log。
 *
 * 設計仕様書 §6: commit はアクティブタブ本文をスナップショット化し、
 * 親＝当該タブの HEAD として新コミットを記録、ブランチ HEAD を更新する。
 */

/** コミット作者（取得できなければ 'unknown'）。 */
function Ggit_author() {
  try {
    var e = Session.getActiveUser().getEmail();
    return e || 'unknown';
  } catch (_) {
    return 'unknown';
  }
}

/** ISO8601（タイムゾーンオフセット付き）のタイムスタンプ。 */
function Ggit_timestamp() {
  var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  return Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/**
 * アクティブタブ本文をコミットする。コミットIDを返す。
 * 変更が無い（前回コミットと同一本文）場合は例外を投げる。
 */
function Ggit_commit(message) {
  var doc = DocumentApp.getActiveDocument();
  var tab = doc.getActiveTab();
  var tabId = tab.getId();

  var meta = Ggit_metaTab(doc);
  if (meta && tabId === meta.getId()) {
    throw new Error('.vcs メタタブはコミットできません。対象のタブを選択してください。');
  }

  var snap = Ggit_serializeTab(tab); // テキスト＋書式の構造化スナップショット
  var store = Ggit_storeLoad(doc);
  var br = store.branches[tabId];
  var parent = br ? br.head : null;

  if (parent && Ggit_materialize(store, parent) === snap) {
    throw new Error('変更がありません（前回コミットと同一の内容です）。');
  }

  var ts = Ggit_timestamp();
  var id = Ggit_commitId(store, tabId, parent, ts, snap);
  var payload = Ggit_makePayload(store, parent, snap);

  store.objects[id] = {
    id: id,
    branch: tabId,
    parent: parent,
    parent2: null,
    message: message,
    author: Ggit_author(),
    timestamp: ts,
    payload: payload
  };
  store.branches[tabId] = { head: id, name: tab.getTitle() };

  Ggit_storeSave(doc, store);
  return id;
}

/** 指定タブ（省略時はアクティブタブ）の HEAD から親方向に辿ったコミット配列。 */
function Ggit_logChain(store, tabId) {
  var br = store.branches[tabId];
  if (!br) return [];
  var out = [];
  var id = br.head;
  while (id) {
    var o = store.objects[id];
    if (!o) break;
    out.push(o);
    id = o.parent;
  }
  return out;
}
