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
 * 差分・追記永続化:
 *   `store.objects` は内容ハッシュをキーにした不変オブジェクトで、1 操作で増えるのは
 *   高々 1 件、変わるのは branches(HEAD) と gen のみ。そこで毎回の全書き直しを避け、
 *   - `.vcs` タブ … 追記型ログ（JSONL）。通常保存は末尾へ 1 行追記（O(新規)）。
 *   - Properties … オブジェクト単位の KV（ggit.o.<id>）＋小さな meta。差分追記のみ。
 *   とする。古い meta 行が溜まったら「圧縮 / 清書」で全清書（コンパクション）する。
 *
 * 非同期バックアップ:
 *   Properties への書き込みは時間ベース一回限りトリガ（Ggit_backupFlush）へ後送りし、
 *   その間は dirty フラグを立てる。次の変更操作は冒頭で Ggit_ensureBackupFresh_ により
 *   保留中のバックアップを同期収束させてから続行する（dirty ガード）。
 *
 * ストア構造（メモリ上）:
 * {
 *   "version": 1,
 *   "gen":      0,            // 単調増加の世代カウンタ（保存ごとに +1）
 *   "objects":  { <commitId>: <commitObject>, ... },
 *   "branches": { <tabId>: { "head": <commitId>, "name": <string> }, ... }
 * }
 */

var GGIT_META_TITLE = '.vcs';

/** PropertiesService キー（差分追記型）。 */
var GGIT_OBJ_PREFIX = 'ggit.o.';        // ggit.o.<id>.n（チャンク数）/ ggit.o.<id>.<i>（チャンク）
var GGIT_META_KEY = 'ggit.meta';        // {version,gen,branches}（小・毎回上書き）
var GGIT_DIRTY_KEY = 'ggit.dirty';      // 非同期バックアップ未完了フラグ（保存待ち gen）
var GGIT_DOCID_KEY = 'ggit.docid';      // 時間トリガから openById するための docId
var GGIT_ERR_KEY = 'ggit.bk_err';       // 直近のバックアップ失敗理由（非同期のため後で提示）
var GGIT_BK_CHUNK = 8000;               // 1プロパティ値の上限(~9KB)を下回るチャンク長
var GGIT_BK_BATCH = 50;                 // setProperties 1回あたりにまとめるオブジェクト数

/** 旧バックアップ形式（後方互換・移行用）。 */
var GGIT_BK_PREFIX = 'ggit.bk.';        // 旧: ggit.bk.gen / ggit.bk.count / ggit.bk.<i>

/** `.vcs` 追記型ログ（JSONL）。 */
var GGIT_LOG_HEADER = 'ggit-log';       // ヘッダ行 {"h":"ggit-log",...} の目印
var GGIT_COMPACT_INTERVAL = 100;        // meta 行がこの数たまったら次回保存で全清書

/** 非同期バックアップのトリガ関数名。 */
var GGIT_BACKUP_TRIGGER = 'Ggit_backupFlush';

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
 * 避けるため行わず、次回 `Ggit_storeSave`／`Ggit_convergeStores_` で反映される。
 */
function Ggit_storeLoad(doc) {
  doc = doc || DocumentApp.getActiveDocument();
  var tabStore = Ggit_tabStoreLoad(doc);
  var backupStore = Ggit_backupLoad(doc);
  return Ggit_pickStore(tabStore, backupStore);
}

/** メタタブ（`.vcs`）本文のみからストアを読み込む（無ければ null）。新旧フォーマット両対応。 */
function Ggit_tabStoreLoad(doc) {
  var t = Ggit_metaTab(doc);
  if (!t) return null;
  var raw = Ggit_tabText(t).trim();
  if (!raw) return null;
  return Ggit_logParse_(raw);
}

/**
 * `.vcs` 本文（生文字列）をストアへ解析する。
 *  - 1行目が ggit-log ヘッダなら新形式（JSONL ログ）としてリプレイ。
 *  - そうでなければ旧形式（単一 JSON ストア）として読む（後方互換）。
 * パース不能行はスキップする（版復元によるログ末尾切れ等への防御）。
 * 解析結果には保存時の判断用に非永続フィールド __logok / __metaSeen を付与する。
 */
function Ggit_logParse_(raw) {
  var lines = raw.split('\n');
  var head = null;
  try { head = JSON.parse(lines[0]); } catch (e) { head = null; }

  if (!head || head.h !== GGIT_LOG_HEADER) {
    // 旧形式: 全体が単一 JSON ストア。
    var s;
    try { s = JSON.parse(raw); } catch (e2) {
      throw new Error('.vcs メタタブのJSON解析に失敗しました（手動編集の可能性）: ' + e2.message);
    }
    s = Ggit_normStore(s);
    s.__logok = false;  // 旧形式 → 次回保存で清書移行
    s.__metaSeen = 0;
    return s;
  }

  // 新形式: JSONL ログをリプレイ。o 行を集約し、最後の m 行を採用する。
  var store = Ggit_emptyStore();
  var metaSeen = 0;
  for (var i = 1; i < lines.length; i++) {
    var ln = lines[i];
    if (!ln) continue;
    var rec;
    try { rec = JSON.parse(ln); } catch (e3) { continue; } // 破損行スキップ
    if (rec.o) {
      store.objects[rec.o] = rec.v;
    } else if (rec.m) {
      store.version = rec.version || store.version;
      store.gen = rec.gen || 0;
      store.branches = rec.branches || {};
      metaSeen++;
    }
  }
  store = Ggit_normStore(store);
  store.__logok = true;
  store.__metaSeen = metaSeen;
  return store;
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
 * ストアをメタタブへ保存し、PropertiesService バックアップは非同期へ後送りする。
 * 世代カウンタを +1 し、`.vcs` タブへ追記（または清書）した後、dirty フラグを立てて
 * バックアップ用トリガを予約する。Properties への書き込みは Ggit_backupFlush で行う。
 *
 * @param newObjectIds この保存で新たに追加されたオブジェクトIDの配列（追記対象）。
 *        省略/未指定の場合は安全側で全清書する。branch のように新規オブジェクトが
 *        無い保存では空配列 [] を渡す（meta 行のみ追記）。
 * 戻り値: { gen, warning }（warning は常に null。バックアップは非同期のため）。
 */
function Ggit_storeSave(doc, store, newObjectIds) {
  doc = doc || DocumentApp.getActiveDocument();
  var docId = doc.getId();
  store.version = store.version || 1;
  store.gen = (store.gen || 0) + 1;

  // `.vcs` タブを一次の永続先として同期書き込み（追記 or 清書）。
  Ggit_tabPersist_(doc, docId, store, newObjectIds);

  // Properties バックアップは非同期へ: docId 記録・dirty 化・トリガ予約。
  try {
    var props = PropertiesService.getDocumentProperties();
    if (props) {
      props.setProperty(GGIT_DOCID_KEY, docId);
      props.setProperty(GGIT_DIRTY_KEY, String(store.gen));
    }
  } catch (e) {
    Logger.log('ggit dirty 設定失敗: ' + e.message);
  }
  Ggit_scheduleBackup_();

  return { gen: store.gen, warning: null };
}

/**
 * `.vcs` タブへの永続化（追記 or 全清書）。
 * 追記条件: メタタブが既に新形式ログで、新規IDが指定され、溜まった meta 行が閾値未満。
 * それ以外（新規ドキュメント・旧形式・巻き戻し採用・コンパクション）は全清書する。
 */
function Ggit_tabPersist_(doc, docId, store, newObjectIds) {
  var t = Ggit_metaTab(doc);
  var canAppend = !!t && store.__logok === true && newObjectIds != null &&
    (store.__metaSeen || 0) < GGIT_COMPACT_INTERVAL;
  if (!t) t = Ggit_createTab(doc, GGIT_META_TITLE);

  if (canAppend) {
    Ggit_appendTabTextApi(docId, t.getId(), Ggit_logAppend_(store, newObjectIds));
    store.__metaSeen = (store.__metaSeen || 0) + 1;
  } else {
    Ggit_setTabTextApi(docId, t.getId(), Ggit_logRewrite_(store));
    store.__logok = true;
    store.__metaSeen = 1;
  }
}

/** ログのヘッダ行。 */
function Ggit_logHeaderLine_(store) {
  return JSON.stringify({ h: GGIT_LOG_HEADER, version: store.version || 1 });
}

/** ログの meta 行（最新の version/gen/branches）。 */
function Ggit_logMetaLine_(store) {
  return JSON.stringify({
    m: 1, version: store.version || 1, gen: store.gen || 0, branches: store.branches || {}
  });
}

/** ストア全体を JSONL ログ文字列へ清書する（ヘッダ＋全オブジェクト＋単一 meta）。 */
function Ggit_logRewrite_(store) {
  var lines = [Ggit_logHeaderLine_(store)];
  for (var id in store.objects) {
    if (store.objects.hasOwnProperty(id)) {
      lines.push(JSON.stringify({ o: id, v: store.objects[id] }));
    }
  }
  lines.push(Ggit_logMetaLine_(store));
  return lines.join('\n');
}

/** 末尾へ追記する文字列（先頭改行＋新オブジェクト行＋meta 行）を生成する。 */
function Ggit_logAppend_(store, newObjectIds) {
  var lines = [];
  for (var i = 0; i < newObjectIds.length; i++) {
    var id = newObjectIds[i];
    var o = store.objects[id];
    if (o) lines.push(JSON.stringify({ o: id, v: o }));
  }
  lines.push(Ggit_logMetaLine_(store));
  return '\n' + lines.join('\n');
}

/* ===================== PropertiesService バックアップ（差分追記） ===================== */

/**
 * ストアを Properties へ差分追記する。既に存在するオブジェクト（不変）は再書き込みせず、
 * 未保存のオブジェクトのみ ggit.o.<id> へ書き、meta を更新する。全削除は行わない。
 * 容量超過などで失敗した場合は throw せず警告文字列を返す（best-effort）。成功時は null。
 */
function Ggit_backupSave(doc, store) {
  try {
    var props = PropertiesService.getDocumentProperties();
    if (!props) return 'バックアップ不可（DocumentProperties が利用できません）。';

    var existing = Ggit_backupObjIds_(props);
    var map = {};
    var pending = 0;
    for (var id in store.objects) {
      if (!store.objects.hasOwnProperty(id)) continue;
      if (existing[id]) continue; // 既存は不変 → 再書き込み不要
      Ggit_propPutObj_(map, id, store.objects[id]);
      if (++pending >= GGIT_BK_BATCH) { props.setProperties(map); map = {}; pending = 0; }
    }
    map[GGIT_META_KEY] = JSON.stringify({
      version: store.version || 1, gen: store.gen || 0, branches: store.branches || {}
    });
    props.setProperties(map);

    Ggit_backupPurgeLegacy_(props); // 旧 ggit.bk.* の残骸を移行掃除
    props.deleteProperty(GGIT_ERR_KEY);
    return null;
  } catch (e) {
    Logger.log('ggit backup 失敗（履歴本体はタブに保存済み）: ' + e.message);
    try { PropertiesService.getDocumentProperties().setProperty(GGIT_ERR_KEY, e.message); } catch (_) {}
    return 'PropertiesService バックアップに失敗しました（容量上限の可能性）。' +
      'タブには保存済みですが、ネイティブ版復元への耐性は今回縮退します: ' + e.message;
  }
}

/** DocumentProperties のバックアップからストアを復元する（無ければ null）。新旧両対応。 */
function Ggit_backupLoad(doc) {
  try {
    var props = PropertiesService.getDocumentProperties();
    if (!props) return null;
    var metaRaw = props.getProperty(GGIT_META_KEY);
    if (!metaRaw) return Ggit_backupLoadLegacy_(props); // 旧形式フォールバック

    var meta = JSON.parse(metaRaw);
    var store = Ggit_emptyStore();
    store.version = meta.version || 1;
    store.gen = meta.gen || 0;
    store.branches = meta.branches || {};
    var ids = Ggit_backupObjIds_(props);
    for (var id in ids) {
      if (!ids.hasOwnProperty(id)) continue;
      var obj = Ggit_propGetObj_(props, id);
      if (obj) store.objects[id] = obj;
    }
    return Ggit_normStore(store);
  } catch (e) {
    Logger.log('ggit backup 読込失敗: ' + e.message);
    return null;
  }
}

/** 旧形式（ggit.bk.count + ggit.bk.<i>）からストアを復元する（後方互換）。 */
function Ggit_backupLoadLegacy_(props) {
  var countStr = props.getProperty('ggit.bk.count');
  if (!countStr) return null;
  var count = parseInt(countStr, 10);
  if (!(count > 0)) return null;
  var parts = [];
  for (var i = 0; i < count; i++) {
    var c = props.getProperty(GGIT_BK_PREFIX + i);
    if (c == null) return null;
    parts.push(c);
  }
  return Ggit_normStore(JSON.parse(Ggit_gunzipB64(parts.join(''))));
}

/** バックアップ済みオブジェクトIDの集合（ggit.o.<id>.n キーから抽出）。 */
function Ggit_backupObjIds_(props) {
  var out = {};
  var keys = props.getKeys();
  var plen = GGIT_OBJ_PREFIX.length;
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k.indexOf(GGIT_OBJ_PREFIX) === 0 && k.length > plen + 2 &&
      k.substring(k.length - 2) === '.n') {
      out[k.substring(plen, k.length - 2)] = true;
    }
  }
  return out;
}

/** 1オブジェクトを gzip+Base64 圧縮し、チャンク群として map へ積む（ggit.o.<id>.n / .<i>）。 */
function Ggit_propPutObj_(map, id, obj) {
  var payload = Ggit_gzipB64(JSON.stringify(obj));
  var chunks = Ggit_chunk(payload, GGIT_BK_CHUNK);
  map[GGIT_OBJ_PREFIX + id + '.n'] = String(chunks.length);
  for (var i = 0; i < chunks.length; i++) map[GGIT_OBJ_PREFIX + id + '.' + i] = chunks[i];
}

/** ggit.o.<id> のチャンク群を結合・復号してオブジェクトへ戻す（欠損時 null）。 */
function Ggit_propGetObj_(props, id) {
  var nStr = props.getProperty(GGIT_OBJ_PREFIX + id + '.n');
  if (!nStr) return null;
  var n = parseInt(nStr, 10);
  var parts = [];
  for (var i = 0; i < n; i++) {
    var c = props.getProperty(GGIT_OBJ_PREFIX + id + '.' + i);
    if (c == null) return null;
    parts.push(c);
  }
  return JSON.parse(Ggit_gunzipB64(parts.join('')));
}

/** 旧形式キー（ggit.bk.*）を削除する（新形式へ移行済みなら残骸掃除）。 */
function Ggit_backupPurgeLegacy_(props) {
  var keys = props.getKeys();
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].indexOf(GGIT_BK_PREFIX) === 0) props.deleteProperty(keys[i]);
  }
}

/** バックアップの現在の使用バイト数（Base64 圧縮後の総文字数）。無ければ 0。 */
function Ggit_backupBytes(doc) {
  try {
    var props = PropertiesService.getDocumentProperties();
    if (!props) return 0;
    var keys = props.getKeys();
    var total = 0;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k.indexOf(GGIT_OBJ_PREFIX) === 0 || k === GGIT_META_KEY ||
        k.indexOf(GGIT_BK_PREFIX) === 0) {
        var v = props.getProperty(k);
        if (v) total += v.length;
      }
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

/* ===================== 非同期バックアップ / 収束 / dirty ガード ===================== */

/** 保留中のバックアップがあるか（dirty フラグ）。 */
function Ggit_isDirty_() {
  try {
    var props = PropertiesService.getDocumentProperties();
    return !!(props && props.getProperty(GGIT_DIRTY_KEY));
  } catch (e) {
    return false;
  }
}

/**
 * バックアップ用の時間ベース一回限りトリガを冪等に予約する。
 * 既に同名トリガがあれば何もしない（トリガ上限・重複発火を避ける）。
 */
function Ggit_scheduleBackup_() {
  try {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === GGIT_BACKUP_TRIGGER) return;
    }
    ScriptApp.newTrigger(GGIT_BACKUP_TRIGGER).timeBased().after(1).create();
  } catch (e) {
    Logger.log('ggit バックアップトリガ予約失敗: ' + e.message);
  }
}

/** バックアップ用トリガを全削除する（後始末）。 */
function Ggit_clearBackupTriggers_() {
  try {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === GGIT_BACKUP_TRIGGER) {
        ScriptApp.deleteTrigger(triggers[i]);
      }
    }
  } catch (e) {
    Logger.log('ggit トリガ削除失敗: ' + e.message);
  }
}

/**
 * 非同期バックアップのトリガ実行関数（引数なし・トップレベル）。
 * 時間トリガには activeDocument が無いため、保存しておいた docId から openById する。
 * DocumentLock 下でストアを収束させ、自分のトリガを後始末する。
 */
function Ggit_backupFlush() {
  var props;
  try { props = PropertiesService.getDocumentProperties(); } catch (e) { return; }
  var docId = props ? props.getProperty(GGIT_DOCID_KEY) : null;
  if (!docId) { Ggit_clearBackupTriggers_(); return; }

  var lock = LockService.getDocumentLock();
  var got = false;
  try { got = lock.tryLock(10000); } catch (e) { got = false; }
  if (got) {
    try {
      Ggit_convergeStores_(DocumentApp.openById(docId));
    } catch (e) {
      Logger.log('ggit backupFlush 失敗: ' + e.message);
    } finally {
      try { lock.releaseLock(); } catch (_) {}
    }
  }
  // ロックが取れなかった場合は他（ユーザ操作のガード）が収束を担うため、トリガは後始末する。
  Ggit_clearBackupTriggers_();
}

/**
 * `.vcs` タブと Properties バックアップを世代の新しい方へ収束させる。
 *  - 巻き戻し（backup.gen > tab.gen）ならタブを採用ストアからヒール（全清書）。
 *  - 採用ストアの未保存オブジェクトを Properties へ差分追記し、meta を更新。
 *  - dirty フラグを解除する。
 * バックグラウンドフラッシュ・dirty ガード・整合性チェックの共通中核。
 */
function Ggit_convergeStores_(doc) {
  doc = doc || DocumentApp.getActiveDocument();
  var docId = doc.getId();
  var tabStore = Ggit_tabStoreLoad(doc);
  var backupStore = Ggit_backupLoad(doc);
  var tabGen = tabStore ? (tabStore.gen || 0) : null;
  var bkGen = backupStore ? (backupStore.gen || 0) : null;
  var pick = Ggit_pickStore(tabStore, backupStore);

  // タブが古い（または存在しない）＝巻き戻しシグナル → 採用ストアでタブをヒール。
  var healedTab = false;
  if (!tabStore || (backupStore && bkGen > tabGen)) {
    var t = Ggit_metaTab(doc) || Ggit_createTab(doc, GGIT_META_TITLE);
    Ggit_setTabTextApi(docId, t.getId(), Ggit_logRewrite_(pick));
    healedTab = true;
  }

  var warning = Ggit_backupSave(doc, pick);

  try { PropertiesService.getDocumentProperties().deleteProperty(GGIT_DIRTY_KEY); } catch (_) {}

  return {
    tabGen: tabGen, bkGen: bkGen, pickGen: pick.gen || 0,
    healedTab: healedTab, warning: warning
  };
}

/**
 * dirty（保留中バックアップ）なら、変更操作に先立って同期的に収束させる。
 * 各変更操作（commit / branch / merge / restore）の冒頭で呼ぶ dirty ガード。
 * バックグラウンドが処理中でロックが取れない場合は、その処理が収束を担うため続行する。
 */
function Ggit_ensureBackupFresh_(doc) {
  if (!Ggit_isDirty_()) return;
  var lock = LockService.getDocumentLock();
  try { lock.waitLock(15000); } catch (e) { return; }
  try {
    Ggit_convergeStores_(doc);
    Ggit_clearBackupTriggers_();
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/**
 * `.vcs` タブと Properties バックアップを現状に即して清書（コンパクション）する。
 *  - 採用ストア（新しい方）を基準に `.vcs` を単一 meta の JSONL へ collapse。
 *  - Properties を孤立キーごと一掃し、現行オブジェクト＋meta で再構成。
 * メニュー「圧縮 / 清書」から呼ぶ。{ gen, objects, bytes } を返す。
 */
function Ggit_compact() {
  var doc = DocumentApp.getActiveDocument();
  var docId = doc.getId();
  var lock = LockService.getDocumentLock();
  try { lock.waitLock(20000); } catch (e) {
    throw new Error('他の処理が実行中です。少し待って再実行してください。');
  }
  try {
    var pick = Ggit_pickStore(Ggit_tabStoreLoad(doc), Ggit_backupLoad(doc));

    var t = Ggit_metaTab(doc) || Ggit_createTab(doc, GGIT_META_TITLE);
    Ggit_setTabTextApi(docId, t.getId(), Ggit_logRewrite_(pick));
    Ggit_backupRewrite_(pick);

    try { PropertiesService.getDocumentProperties().deleteProperty(GGIT_DIRTY_KEY); } catch (_) {}
    Ggit_clearBackupTriggers_();

    var n = 0;
    for (var id in pick.objects) { if (pick.objects.hasOwnProperty(id)) n++; }
    return { gen: pick.gen || 0, objects: n, bytes: Ggit_backupBytes(doc) };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/** Properties を全削除してから現行ストアで再構成する（清書用）。 */
function Ggit_backupRewrite_(store) {
  var props = PropertiesService.getDocumentProperties();
  if (!props) return;
  var keys = props.getKeys();
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k.indexOf(GGIT_OBJ_PREFIX) === 0 || k.indexOf(GGIT_BK_PREFIX) === 0) {
      props.deleteProperty(k);
    }
  }
  var map = {};
  var pending = 0;
  for (var id in store.objects) {
    if (!store.objects.hasOwnProperty(id)) continue;
    Ggit_propPutObj_(map, id, store.objects[id]);
    if (++pending >= GGIT_BK_BATCH) { props.setProperties(map); map = {}; pending = 0; }
  }
  map[GGIT_META_KEY] = JSON.stringify({
    version: store.version || 1, gen: store.gen || 0, branches: store.branches || {}
  });
  props.setProperties(map);
  props.deleteProperty(GGIT_ERR_KEY);
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
  // script.scriptapp スコープ（トリガ作成）も初回認可に含める。
  try { ScriptApp.getProjectTriggers(); } catch (_) {}
  return { title: doc.getName(), tabCount: tabs.length };
}
