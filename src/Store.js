/**
 * Store.js — オブジェクトストア（コミットグラフ）の永続化。
 *
 * 配置は設計仕様書 §5.2 の「案A」を基本としつつ、Google ネイティブ版復元
 * （ファイル > 変更履歴 > この版に戻す）への耐性のため PropertiesService
 * （DocumentProperties）への外部バックアップを併設する「ハイブリッド」方式を採る（§5.4）。
 *
 * 背景: ネイティブ版復元はドキュメント全体を巻き戻すため、`.vcs` タブもろともメタストアが
 * 過去へ戻り、それ以降の履歴が失われる。DocumentProperties はドキュメント本文ではないため
 * 版復元の影響を受けない。これを「正」として保持し、単調増加の世代カウンタ `gen` で巻き戻しを
 * 検知して履歴を復旧する。
 *
 * ストア構造（version 3: Jujutsu 流ブックマークモデル）:
 * {
 *   "version": 3,
 *   "gen":       0,                     // 単調増加の世代カウンタ（保存ごとに +1）。巻き戻し検知用
 *   "objects":   { <commitId>: <commitObject>, ... },  // 通常コミット＋スタッシュ（stash:true）
 *   "bookmarks": { <bookmarkName>: <commitId>, ... },  // 手動の名前付きポインタ（commitで自動前進しない）
 *   "working":   <commitId>            // 現在地 @（匿名ヘッド）。未確立なら null
 * }
 * jj と同様、commit は working（現在地）だけを前進させ、ブックマークは明示操作でのみ動かす。
 * スタッシュは DAG の外ではなく objects 内の stash:true 付きコミットとして表現する（§Stash.js）。
 *
 * 旧スキーマは読み込み時に Ggit_migrateStore で自動移行する:
 *  - version 1（branches が <tabId>:{head,name}、head 概念なし。「タブ＝ブランチ」）
 *  - version 2（branches が <branchName>:<headCommitId>、head=現在ブランチ、stashes[] 配列）
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
  return { version: 3, gen: 0, objects: {}, bookmarks: {}, working: null };
}

/**
 * メタタブと PropertiesService バックアップの両方を読み、世代（gen）の新しい方を採用する。
 *
 * ネイティブ版復元で `.vcs` タブが巻き戻された場合（backup.gen > tab.gen）はバックアップを
 * 正として返し、履歴喪失を防ぐ。読み取り経路では副作用（Docs API 書き込み）を避けるためタブへの
 * 書き戻し（ヒール）は行わず、次回 Ggit_storeSave で自動反映される（遅延ヒール）。復元直後に
 * 確実に整合させたい場合はメニュー「整合性チェック / 復旧」で即時ヒールできる。
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
  s.objects = s.objects || {};
  return Ggit_migrateStore(s);
}

/**
 * タブストアとバックアップストアから採用するストアを決定する（純粋関数）。
 *  - 両方 null   → 空ストア。
 *  - 片方のみ    → 在る方。
 *  - 両方存在    → gen の大きい方（同点はタブを優先）。
 * backup.gen > tab.gen はネイティブ版復元によるタブ巻き戻しのシグナル。
 */
function Ggit_pickStore(tabStore, backupStore) {
  if (!tabStore && !backupStore) return Ggit_emptyStore();
  if (!backupStore) return tabStore;
  if (!tabStore) return backupStore;
  return ((backupStore.gen || 0) > (tabStore.gen || 0)) ? backupStore : tabStore;
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
  // `.vcs` 初回生成時、Ggit_createTab は openById で開いた「2つ目のライブインスタンス」の
  // タブを返す。そのタブへ DocumentApp で書くと、実行終了時のフラッシュ競合で書き込みが
  // 消える（＝初回コミットでストアごと失われる）。Docs API 経由で書いて競合を回避する。
  Ggit_setTabTextApi(docId, t.getId(), JSON.stringify(store));
  return { gen: store.gen, warning: warning };
}

/* ===================== PropertiesService バックアップ（ハイブリッド） ===================== */

/**
 * ストアを gzip+Base64 圧縮し、~8KB チャンクに分割して DocumentProperties へ保存する。
 * 容量上限（合計 ~500KB）超過などで失敗した場合は throw せず警告文字列を返す（best-effort）。
 * 成功時は null を返す。gzip ヘルパ（Ggit_gzipB64）は Snapshot.js のものを流用する。
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
    var s = JSON.parse(Ggit_gunzipB64(parts.join('')));
    s.objects = s.objects || {};
    return Ggit_migrateStore(s);
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

/** `.vcs` メタタブが存在するか（＝初期化済みか）。 */
function Ggit_isInitialized(doc) {
  return !!Ggit_metaTab(doc || DocumentApp.getActiveDocument());
}

/**
 * 初期化（権限付与）— これ「だけ」で初回セットアップを完結させる。
 *
 * onOpen は AuthMode.NONE で動くため、初回の本格操作（commit 等）で認可ダイアログが出ると、
 * その関数は再実行されずに中断される。そこで初回はまず本関数で (1) 必要スコープに触れて認可を
 * 済ませ、(2) 空ストアの `.vcs` メタタブを作るところまでやって終わる。以降、commit などは
 * 「`.vcs` を新規生成する」副作用を持たずに済む（＝初回コミットでの生成競合・認可中断が起きない）。
 *
 * 既に初期化済み（`.vcs` あり）なら作成はスキップする。戻り値: { created, title, tabCount }。
 */
function Ggit_setup() {
  var doc = DocumentApp.getActiveDocument();
  try { Session.getActiveUser().getEmail(); } catch (_) {}                 // userinfo.email スコープに触れる
  try { People.People.get('people/me', { personFields: 'names' }); } catch (_) {} // userinfo.profile（People）に触れる
  var existed = Ggit_isInitialized(doc);
  if (!existed) {
    Ggit_storeSave(doc, Ggit_emptyStore()); // `.vcs` を空ストアで生成（Docs API 書き込み）
  }
  var tabs = Ggit_allTabs(doc);
  return { created: !existed, title: doc.getName(), tabCount: tabs.length };
}

/**
 * 旧スキーマを最新（version 3: Jujutsu 流ブックマークモデル）へ移行する。純粋関数。
 *  - version 1（branches が <tabId>:{head,name}）→ まず branches を <branchName>:<headCommitId> へ正規化。
 *  - version 2（branches/head/stashes[]）→ branches を bookmarks へ、head を working（コミットID）へ、
 *    stashes[] 各要素を stash:true のコミットへ変換して objects に投入する。
 * 既に version 3 のストアはそのまま返す（working 欠落時のみ補う）。
 */
function Ggit_migrateStore(s) {
  if (s.version >= 3) {
    if (s.working === undefined) s.working = null;
    s.bookmarks = s.bookmarks || {};
    if (s.gen === undefined) s.gen = 0;
    return s;
  }

  // --- v1 → v2 相当: branches を <branchName>:<headCommitId> へ正規化 ---
  var branches = {};
  for (var k in s.branches) {
    if (!s.branches.hasOwnProperty(k)) continue;
    var v = s.branches[k];
    if (v && typeof v === 'object' && v.head !== undefined) {
      var name = v.name || k;                       // タブ名（無ければ tabId）を採用
      var base = name, i = 2;
      while (branches.hasOwnProperty(name)) { name = base + '-' + i; i++; } // 同名は連番で一意化
      branches[name] = v.head;
    } else {
      branches[k] = v;                              // 既に文字列 HEAD
    }
  }

  // --- v2 → v3: branches→bookmarks、head→working、stashes[]→stash コミット ---
  s.bookmarks = branches;
  s.working = (s.head && branches.hasOwnProperty(s.head)) ? branches[s.head] : null;

  var stashes = s.stashes || [];
  for (var j = 0; j < stashes.length; j++) {
    var st = stashes[j];
    if (!st || !st.data) continue;
    var parent = (st.branchName && branches.hasOwnProperty(st.branchName))
      ? branches[st.branchName] : null;
    var id = st.id;
    while (s.objects.hasOwnProperty(id)) id = id + 'x';   // 既存IDと衝突しないようにする
    s.objects[id] = {
      id: id, parent: parent, parent2: null,
      message: st.message || 'スタッシュ（移行）',
      author: st.author || 'unknown',
      timestamp: st.timestamp || '',
      payload: { type: 'full', data: st.data },           // st.data は gzip+Base64 のスナップショット
      stash: true
    };
  }

  delete s.branches;
  delete s.head;
  delete s.stashes;
  s.version = 3;
  if (s.gen === undefined) s.gen = 0;
  return s;
}

/**
 * 現在地 working（コミットID）を解決する。store.working が有効な object を指せばそれを返す。
 * 未設定（または無効）なら null。jj では working は名前ではなくコミットID。
 */
function Ggit_resolveWorking(doc, store) {
  if (store.working && store.objects.hasOwnProperty(store.working)) return store.working;
  return null;
}
