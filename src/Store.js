/**
 * Store.js — オブジェクトストア（コミットグラフ）の永続化。
 *
 * 配置は設計仕様書 §5.2 の「案A」を採用し、`.vcs` というタイトルの
 * ドキュメントタブ本文に JSON 文字列としてストアを格納する。
 *
 * ストア構造:
 * {
 *   "version": 1,
 *   "objects":  { <commitId>: <commitObject>, ... },
 *   "branches": { <tabId>: { "head": <commitId>, "name": <string> }, ... }
 * }
 */

var GGIT_META_TITLE = '.vcs';

/** `.vcs` メタタブを返す（無ければ null）。 */
function Ggit_metaTab(doc) {
  var all = Ggit_allTabs(doc);
  for (var i = 0; i < all.length; i++) {
    if (all[i].getTitle() === GGIT_META_TITLE) return all[i];
  }
  return null;
}

/** 空のストアを生成。 */
function Ggit_emptyStore() {
  return { version: 1, objects: {}, branches: {} };
}

/** メタタブからストアを読み込む（無ければ空ストア）。 */
function Ggit_storeLoad(doc) {
  doc = doc || DocumentApp.getActiveDocument();
  var t = Ggit_metaTab(doc);
  if (!t) return Ggit_emptyStore();
  var raw = Ggit_tabText(t).trim();
  if (!raw) return Ggit_emptyStore();
  var s;
  try {
    s = JSON.parse(raw);
  } catch (e) {
    throw new Error('.vcs メタタブのJSON解析に失敗しました（手動編集の可能性）: ' + e.message);
  }
  s.version = s.version || 1;
  s.objects = s.objects || {};
  s.branches = s.branches || {};
  return s;
}

/** ストアをメタタブへ書き戻す（メタタブが無ければ生成）。 */
function Ggit_storeSave(doc, store) {
  doc = doc || DocumentApp.getActiveDocument();
  var docId = doc.getId();
  var t = Ggit_metaTab(doc);
  if (!t) {
    t = Ggit_createTab(doc, GGIT_META_TITLE);
  }
  // DocumentApp の二重インスタンスによる書き込み消失（特に `.vcs` 初回生成時）を避けるため
  // Docs API 経由で書き込む。
  Ggit_setTabTextApi(docId, t.getId(), JSON.stringify(store));
}

/**
 * 認可を確実に発火させるための no-op 認可関数（Setup メニューから呼ぶ）。
 *
 * onOpen は AuthMode.NONE で動くため、初回の本格操作（commit 等）で認可ダイアログが
 * 出ると、その関数は再実行されずに中断される。本関数を先に一度実行して認可を済ませることで、
 * 最初の commit が認可中断で消える事象を避ける。ドキュメント名とタブ数を返す。
 */
function Ggit_authorize() {
  var doc = DocumentApp.getActiveDocument();
  var tabs = Ggit_allTabs(doc); // documents スコープに触れる読み取り
  try { Session.getActiveUser().getEmail(); } catch (_) {}
  return { title: doc.getName(), tabCount: tabs.length };
}
