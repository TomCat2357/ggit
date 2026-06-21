/**
 * Commit.js — commit / log。
 *
 * 設計仕様書 §6: commit はアクティブタブ本文をスナップショット化し、
 * 親＝現在地 working として新コミットを記録、working（現在地 @）を新コミットへ前進させる。
 * Jujutsu と同様、ブックマークは commit では動かさない（明示操作でのみ移動）。
 */

/**
 * コミット作者の表示名（ユーザー名）。People API（要 userinfo.profile スコープ）で
 * 自分のプロフィール名を引く。取得できなければ空文字。
 * 一次名（metadata.primary）を優先し、無ければ先頭の displayName を使う。
 */
function Ggit_authorName_() {
  try {
    var resp = People.People.get('people/me', { personFields: 'names' });
    var names = (resp && resp.names) || [];
    for (var i = 0; i < names.length; i++) {
      if (names[i].metadata && names[i].metadata.primary && names[i].displayName) {
        return names[i].displayName;
      }
    }
    if (names.length && names[0].displayName) return names[0].displayName;
  } catch (_) {}
  return '';
}

/** コミット作者のメールアドレス（要 userinfo.email スコープ）。取得できなければ空文字。 */
function Ggit_authorEmail_() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (_) {
    return '';
  }
}

/**
 * コミット作者を git 形式の識別子「ユーザー名 <メールアドレス>」で返す。
 *  - 名前・メールが揃う … "名前 <メール>"
 *  - メールのみ取得     … "メール"
 *  - 名前のみ取得       … "名前"
 *  - どちらも取れない   … 'unknown'
 * 旧コミット（author が生メールのみ）とも互換: author は単一文字列のまま。
 */
function Ggit_author() {
  var name = Ggit_authorName_();
  var email = Ggit_authorEmail_();
  if (name && email) return name + ' <' + email + '>';
  if (email) return email;
  if (name) return name;
  return 'unknown';
}

/** ISO8601（タイムゾーンオフセット付き）のタイムスタンプ。 */
function Ggit_timestamp() {
  var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  return Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/**
 * ドキュメントの最新 Drive リビジョンを keepForever で固定し、{ id, time } を返す。
 * コミットは完全テキストベースなので、書式・表・画像の完全な再現はこの固定版（Google
 * ドキュメントの変更履歴）の「復元」に委譲する。keepForever 化は best-effort（保持上限
 * 超過などで失敗しても無視）。リビジョンが取得できなければ null。
 * 要: Drive 拡張サービス（v3）と drive スコープ。
 */
function Ggit_pinHeadRevision_(docId) {
  var list = Drive.Revisions.list(docId, { fields: 'revisions(id,modifiedTime)' });
  var revs = (list && list.revisions) || [];
  if (!revs.length) return null;
  var head = revs[revs.length - 1]; // 昇順の末尾＝最新
  try {
    Drive.Revisions.update({ keepForever: true }, docId, head.id);
  } catch (_) {}
  return { id: head.id, time: head.modifiedTime || '' };
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

  var snap = Ggit_serializeTab(tab); // 完全テキストベースのスナップショット（表は Markdown）
  var store = Ggit_storeLoad(doc);

  // 親＝現在地 working。初回（未確立）は parent=null。
  var parent = Ggit_resolveWorking(doc, store);

  // 防御: 現在地が（移行データ等で）スタッシュを指している場合、スタッシュは履歴の親に
  // なってはならない。実在する直近の非スタッシュ祖先へ繋ぎ直す（無ければ初回扱い null）。
  // Ggit_goto はスタッシュへの移動を禁止しているため通常はここを通らない。
  if (parent && store.objects[parent] && store.objects[parent].stash) {
    parent = Ggit_firstNonStashAncestor_(store, parent);
  }

  if (parent && Ggit_plainOf(Ggit_materialize(store, parent)) === Ggit_plainOf(snap)) {
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

  // このコミットに最寄りのネイティブ版（Drive リビジョン）を keepForever で固定し、
  // 完全な書式・表・画像の再現を後から「変更履歴」から行えるようにする
  // （best-effort: Drive 不調でも commit は失敗させない）。
  try {
    var rev = Ggit_pinHeadRevision_(doc.getId());
    if (rev) store.objects[id].revision = rev;
  } catch (_) {}

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
