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
  var t = Ggit_metaTab(doc);
  if (!t) {
    t = Ggit_createTab(doc, GGIT_META_TITLE);
  }
  Ggit_setTabText(t, JSON.stringify(store));
}
