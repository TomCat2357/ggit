/**
 * Store.js — オブジェクトストア（コミットグラフ）の永続化。
 *
 * 配置は設計仕様書 §5.2 の「案A」を基本としつつ、Google ネイティブ版復元
 * （ファイル > 変更履歴 > この版に戻す）への耐性のため PropertiesService
 * （DocumentProperties）への外部バックアップを併設する「ハイブリッド」方式を採る。
 *
 * 背景: ネイティブ版復元はドキュメント全体を巻き戻すため、`.vcs` タブもろとも
 * メタストアが過去へ戻り、それ以降の履歴が失われる。DocumentProperties は
 * ドキュメント本文ではないため版復元の影響を受けない。これを「正」として保持し、
 * 単調増加の世代カウンタ `gen` で巻き戻しを検知して履歴を復旧する（設計仕様書 §5.2）。
 *
 * ストア構造:
 * {
 *   "version": 1,
 *   "gen":      0,            // 単調増加の世代カウンタ（保存ごとに +1）
 *   "objects":  { <commitId>: <commitObject>, ... },
 *   "branches": { <tabId>: { "head": <commitId>, "name": <string> }, ... }
 * }
 */

var GGIT_META_TITLE = '.vcs';

/** PropertiesService バックアップのキー接頭辞とチャンクサイズ。 */
var GGIT_BK_PREFIX = 'ggit.bk.';        // ggit.bk.gen / ggit.bk.count / ggit.bk.<i>
var GGIT_BK_CHUNK = 8000;               // 1プロパティ値の上限(~9KB)を下回るチャンク長

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
  return { version: 1, gen: 0, objects: {}, branches: {} };
}

/** ストアオブジェクトの欠損フィールドを既定値で補う（タブ/バックアップ共通）。 */
function Ggit_normStore(s) {
  s.version = s.version || 1;
  s.gen = s.gen || 0;
  s.objects = s.objects || {};
  s.branches = s.branches || {};
  return s;
}

/**
 * メタタブと PropertiesService バックアップの両方を読み、世代の新しい方を採用する。
 *
 * ネイティブ版復元で `.vcs` タブが巻き戻された場合（backup.gen > tab.gen）は
 * バックアップを正として返し、履歴喪失を防ぐ。タブへの書き戻し（ヒール）は副作用を
 * 避けるため行わず、次回 `Ggit_storeSave` で自動反映される（遅延ヒール）。
 */
function Ggit_storeLoad(doc) {
  doc = doc || DocumentApp.getActiveDocument();
  var tabStore = Ggit_tabStoreLoad(doc);
  var backupStore = Ggit_backupLoad(doc);
  return Ggit_pickStore(tabStore, backupStore);
}

/** メタタブ（`.vcs`）本文のみからストアを読み込む（無ければ null）。 */
function Ggit_tabStoreLoad(doc) {
  var t = Ggit_metaTab(doc);
  if (!t) return null;
  var raw = Ggit_tabText(t).trim();
  if (!raw) return null;
  var s;
  try {
    s = JSON.parse(raw);
  } catch (e) {
    throw new Error('.vcs メタタブのJSON解析に失敗しました（手動編集の可能性）: ' + e.message);
  }
  return Ggit_normStore(s);
}

/**
 * タブストアとバックアップストアから採用するストアを決定する（純粋関数）。
 *  - 両方 null      → 空ストア。
 *  - 片方のみ存在    → 在る方。
 *  - 両方存在        → gen の大きい方（同点はタブを優先）。
 * backup.gen > tab.gen はネイティブ版復元によるタブ巻き戻しのシグナル。
 */
function Ggit_pickStore(tabStore, backupStore) {
  if (!tabStore && !backupStore) return Ggit_emptyStore();
  if (!backupStore) return tabStore;
  if (!tabStore) return backupStore;
  return (backupStore.gen > tabStore.gen) ? backupStore : tabStore;
}

/**
 * ストアをメタタブと PropertiesService バックアップの両方へ保存する。
 * 世代カウンタを +1 し、巻き戻しに耐えるバックアップ（Properties）を **先に** 書いてから
 * タブへ書く。バックアップは best-effort（容量超過等でも throw せず警告を返す）。
 * 戻り値: { gen, warning }（warning は失敗時のみ文字列、成功時 null）。
 */
function Ggit_storeSave(doc, store) {
  doc = doc || DocumentApp.getActiveDocument();
  var docId = doc.getId();
  store.gen = (store.gen || 0) + 1;

  // 先にバックアップ（Properties は版復元の影響を受けないため、ここが「正」の砦）。
  var warning = Ggit_backupSave(doc, store);

  var t = Ggit_metaTab(doc);
  if (!t) {
    t = Ggit_createTab(doc, GGIT_META_TITLE);
  }
  // DocumentApp の二重インスタンスによる書き込み消失（特に `.vcs` 初回生成時）を避けるため
  // Docs API 経由で書き込む。
  Ggit_setTabTextApi(docId, t.getId(), JSON.stringify(store));
  return { gen: store.gen, warning: warning };
}

/* ===================== PropertiesService バックアップ（ハイブリッド） ===================== */

/**
 * ストアを gzip+Base64 圧縮し、~8KB チャンクに分割して DocumentProperties へ保存する。
 * 容量上限（合計 ~500KB）超過などで失敗した場合は throw せず警告文字列を返す（best-effort）。
 * 成功時は null を返す。
 */
function Ggit_backupSave(doc, store) {
  try {
    var props = PropertiesService.getDocumentProperties();
    if (!props) return 'バックアップ不可（DocumentProperties が利用できません）。';
    var payload = Ggit_gzipB64(JSON.stringify(store));
    var chunks = Ggit_chunk(payload, GGIT_BK_CHUNK);

    // 旧チャンクを削除してから新チャンクを書く（チャンク数が減った場合の残骸を残さない）。
    var keys = props.getKeys();
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].indexOf(GGIT_BK_PREFIX) === 0) props.deleteProperty(keys[i]);
    }
    var map = { 'ggit.bk.gen': String(store.gen || 0), 'ggit.bk.count': String(chunks.length) };
    for (var j = 0; j < chunks.length; j++) map[GGIT_BK_PREFIX + j] = chunks[j];
    props.setProperties(map);
    return null;
  } catch (e) {
    Logger.log('ggit backup 失敗（履歴本体はタブに保存済み）: ' + e.message);
    return 'PropertiesService バックアップに失敗しました（容量上限の可能性）。' +
      'タブには保存済みですが、ネイティブ版復元への耐性は今回縮退します: ' + e.message;
  }
}

/** DocumentProperties のバックアップからストアを復元する（無ければ null）。 */
function Ggit_backupLoad(doc) {
  try {
    var props = PropertiesService.getDocumentProperties();
    if (!props) return null;
    var countStr = props.getProperty('ggit.bk.count');
    if (!countStr) return null;
    var count = parseInt(countStr, 10);
    if (!(count > 0)) return null;
    var parts = [];
    for (var i = 0; i < count; i++) {
      var c = props.getProperty(GGIT_BK_PREFIX + i);
      if (c == null) return null; // 欠損チャンク → バックアップ不完全とみなし無効
      parts.push(c);
    }
    var json = Ggit_gunzipB64(parts.join(''));
    return Ggit_normStore(JSON.parse(json));
  } catch (e) {
    Logger.log('ggit backup 読込失敗: ' + e.message);
    return null;
  }
}

/** バックアップの現在の使用バイト数（Base64 圧縮後の総文字数）。無ければ 0。 */
function Ggit_backupBytes(doc) {
  try {
    var props = PropertiesService.getDocumentProperties();
    if (!props) return 0;
    var countStr = props.getProperty('ggit.bk.count');
    if (!countStr) return 0;
    var count = parseInt(countStr, 10);
    var total = 0;
    for (var i = 0; i < count; i++) {
      var c = props.getProperty(GGIT_BK_PREFIX + i);
      if (c) total += c.length;
    }
    return total;
  } catch (e) {
    return 0;
  }
}

/** 文字列を size 文字ごとのチャンク配列へ分割する（純粋関数）。 */
function Ggit_chunk(str, size) {
  var out = [];
  for (var i = 0; i < str.length; i += size) out.push(str.substring(i, i + size));
  return out;
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
