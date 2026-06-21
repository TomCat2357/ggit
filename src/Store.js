/**
 * Store.js — オブジェクトストア（コミットグラフ）の永続化。
 *
 * 配置は設計仕様書 §5.2 の「案A」を採用し、`.vcs` というタイトルの
 * ドキュメントタブ本文に JSON 文字列としてストアを格納する。
 *
 * ストア構造（version 3: Jujutsu 流ブックマークモデル）:
 * {
 *   "version": 3,
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
  return { version: 3, objects: {}, bookmarks: {}, working: null };
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
  s.objects = s.objects || {};
  return Ggit_migrateStore(s);
}

/** ストアをメタタブへ書き戻す（メタタブが無ければ生成）。 */
function Ggit_storeSave(doc, store) {
  doc = doc || DocumentApp.getActiveDocument();
  var docId = doc.getId();
  var t = Ggit_metaTab(doc);
  if (!t) {
    t = Ggit_createTab(doc, GGIT_META_TITLE);
  }
  // `.vcs` 初回生成時、Ggit_createTab は openById で開いた「2つ目のライブインスタンス」の
  // タブを返す。そのタブへ DocumentApp で書くと、実行終了時のフラッシュ競合で書き込みが
  // 消える（＝初回コミットでストアごと失われる）。Docs API 経由で書いて競合を回避する。
  Ggit_setTabTextApi(docId, t.getId(), JSON.stringify(store));
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
  try { Session.getActiveUser().getEmail(); } catch (_) {} // 認可スコープに触れる
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
