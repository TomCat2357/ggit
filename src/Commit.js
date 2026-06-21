/**
 * Commit.js — commit / log。
 *
 * 設計仕様書 §6: commit はアクティブタブ本文をスナップショット化し、
 * 親＝現在地 working として新コミットを記録、working（現在地 @）を新コミットへ前進させる。
 * Jujutsu と同様、ブックマークは commit では動かさない（明示操作でのみ移動）。
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

  // 親＝現在地 working。初回（未確立）は parent=null。
  var parent = Ggit_resolveWorking(doc, store);

  // 防御: 現在地が（移行データ等で）スタッシュを指している場合、スタッシュは履歴の親に
  // なってはならない。実在する直近の非スタッシュ祖先へ繋ぎ直す（無ければ初回扱い null）。
  // Ggit_goto はスタッシュへの移動を禁止しているため通常はここを通らない。
  if (parent && store.objects[parent] && store.objects[parent].stash) {
    parent = Ggit_firstNonStashAncestor_(store, parent);
  }

  if (parent && Ggit_materialize(store, parent) === snap) {
    throw new Error('変更がありません（前回コミットと同一の内容です）。');
  }

  var ts = Ggit_timestamp();
  var id = Ggit_commitId(store, parent, ts, snap);
  var payload = Ggit_makePayload(store, parent, snap);

  store.objects[id] = {
    id: id,
    parent: parent,
    parent2: null,
    message: message,
    author: Ggit_author(),
    timestamp: ts,
    payload: payload
  };
  store.working = id; // 現在地 @ のみ前進（ブックマークは動かさない＝jj）

  Ggit_storeSave(doc, store);
  return id;
}

/**
 * id（自身を含む）から親方向へ辿り、最初に現れる「実在する非スタッシュ」コミットIDを返す。
 * スタッシュ（stash:true）は飛ばす。連鎖が途中で欠落（参照先が無い）したら null を返す。
 * commit がスタッシュを親に取ってしまわないための繋ぎ直し先を求めるのに使う。
 */
function Ggit_firstNonStashAncestor_(store, id) {
  var cur = id;
  while (cur) {
    var o = store.objects[cur];
    if (!o) return null;       // 連鎖が壊れている（参照先欠落）
    if (!o.stash) return cur;  // 実コミットに到達
    cur = o.parent;
  }
  return null;
}

/** 指定コミットIDから親方向に辿ったコミット配列（フラットログ・status 用）。 */
function Ggit_logChain(store, startId) {
  var out = [];
  var id = startId || null;
  while (id) {
    var o = store.objects[id];
    if (!o) break;
    out.push(o);
    id = o.parent;
  }
  return out;
}
