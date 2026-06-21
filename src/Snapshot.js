/**
 * Snapshot.js — payload（full/delta）の生成・復元と gzip+Base64 圧縮。
 *
 * 設計仕様書 §5.1 / §5.3:
 *  - payload.type = "full"  … 本文全文を gzip+Base64
 *  - payload.type = "delta" … 親→当該コミットの diff-match-patch パッチを gzip+Base64
 *  - 一定間隔でフルスナップショット（基準点）を挿入し、復元時の差分連鎖を短く保つ。
 */

/** delta が連続する上限。これを超える前にフルスナップショットを挿入する。 */
var GGIT_FULL_INTERVAL = 20;

/** テキストを gzip+Base64 で圧縮。 */
function Ggit_gzipB64(text) {
  var gz = Utilities.gzip(Utilities.newBlob(text, 'text/plain'));
  return Utilities.base64Encode(gz.getBytes());
}

/** gzip+Base64 を復号してテキストへ戻す。 */
function Ggit_gunzipB64(b64) {
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'application/x-gzip');
  return Utilities.ungzip(blob).getDataAsString('UTF-8');
}

/** parentId から遡り、直近のフルスナップショットまでの delta 連続数を返す。 */
function Ggit_deltasSinceFull(store, parentId) {
  var n = 0, id = parentId;
  while (id) {
    var o = store.objects[id];
    if (!o) break;
    if (o.payload.type === 'full') break;
    n++;
    id = o.parent;
  }
  return n;
}

/**
 * 親と本文から payload を生成する。
 * 親が無い、または delta 連鎖が上限間際なら full、それ以外は delta。
 */
function Ggit_makePayload(store, parentId, fullText) {
  if (!parentId) {
    return { type: 'full', data: Ggit_gzipB64(fullText) };
  }
  if (Ggit_deltasSinceFull(store, parentId) >= GGIT_FULL_INTERVAL - 1) {
    return { type: 'full', data: Ggit_gzipB64(fullText) };
  }
  var parentText = Ggit_materialize(store, parentId);
  var dmp = new diff_match_patch();
  var patches = dmp.patch_make(parentText, fullText);
  return { type: 'delta', data: Ggit_gzipB64(dmp.patch_toText(patches)) };
}

/**
 * 指定コミットの本文を実際に復元せずに「復元可能か」を構造的に判定する純粋関数。
 *
 * materialize と同じ向き（payload が delta の間だけ parent を辿り、full に当たれば確定）で
 * 連鎖を辿り、full に到達できれば true。途中で参照先オブジェクトが欠落していたり
 * （例: 親が破棄された 5653e7bf を指す）、payload が無い／delta なのに親が無い場合は
 * 連鎖が「繋がっていない」ため false（＝壊れたコミット）。
 *
 * GAS ランタイム非依存（gzip/Docs API を呼ばない）なので SelfTest でユニット検証できる。
 */
function Ggit_canMaterialize(store, id) {
  var objects = store.objects || {};
  var cur = id;
  for (var guard = 0; cur && guard < 1000000; guard++) {
    var o = objects[cur];
    if (!o || !o.payload) return false; // 参照先欠落 or payload 欠落 → 復元不能
    if (o.payload.type === 'full') return true; // 基準点に到達
    cur = o.parent; // delta は親方向へ
  }
  return false; // full に当たらず連鎖が尽きた（delta なのに親が無い等）
}

/**
 * 指定コミットの本文全文を復元する。
 * コミットから親方向へ直近の full まで遡り、full 本文に delta を順方向適用する。
 */
function Ggit_materialize(store, id) {
  var chain = [];
  var cur = id;
  while (cur) {
    var o = store.objects[cur];
    if (!o) throw new Error('オブジェクトが見つかりません: ' + cur);
    chain.push(o);
    if (o.payload.type === 'full') break;
    cur = o.parent;
  }
  chain.reverse(); // [full(基準点), delta, delta, ... , target]

  var text = Ggit_gunzipB64(chain[0].payload.data);
  var dmp = new diff_match_patch();
  for (var i = 1; i < chain.length; i++) {
    var patches = dmp.patch_fromText(Ggit_gunzipB64(chain[i].payload.data));
    text = dmp.patch_apply(patches, text)[0];
  }
  return text;
}

/* ===================== スナップショット（完全テキストベース） ===================== */
/*
 * コミットの「素材」は完全テキストベースの JSON 文字列とする（書式は記録しない）。
 *   { "v":2, "text": <本文の正準テキスト。表は Markdown のパイプ表> }
 * - text を diff/merge がそのまま射影（Ggit_plainOf）して使う。
 * - 圧縮/delta/コミットID は文字列処理なので、この JSON 文字列をそのまま流せる。
 *
 * 後方互換: 旧 `.vcs`（v:1 の書式付き JSON、または生プレーンテキスト）も Ggit_parseSnap /
 * Ggit_plainOf が text を透過的に取り出せるため、既存ドキュメントを壊さない（書式は無視）。
 *
 * 完全再現の方針: 書式・表・画像の完全な再現は、各コミットに紐づけて keepForever で固定した
 * ネイティブ版（Google ドキュメントの変更履歴）の「復元」に委譲する。
 */

/** スナップショット文字列を { v, text, fmt } へ復号。旧プレーン payload は {text:raw} 扱い。 */
function Ggit_parseSnap(s) {
  if (s == null) return { v: 0, text: '', fmt: null };
  var o = null;
  try { o = JSON.parse(s); } catch (e) { o = null; }
  if (o && typeof o === 'object' && o.v && typeof o.text === 'string') return o;
  // 旧形式（生プレーンテキスト）または非該当 JSON はそのままテキストとして扱う。
  return { v: 0, text: String(s), fmt: null };
}

/** スナップショット文字列からプレーン全文を取り出す（diff/merge 用・後方互換）。 */
function Ggit_plainOf(s) {
  return Ggit_parseSnap(s).text;
}

/** 表セル内テキストを Markdown 表のセル用に正規化（改行→空白、`|` をエスケープ）。 */
function Ggit_mdCell_(s) {
  return String(s == null ? '' : s).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

/**
 * Table 要素を Markdown のパイプ表（| a | b |）へ変換する。
 * 1行目をヘッダ、2行目を区切り（| --- | …）、以降をデータ行とする。
 * 行ごとにセル数が異なる場合は最大列数に空セルで揃える。
 * フィデリティ境界: ネスト表・結合セルは非対応（セルのテキスト内容のみ）。
 */
function Ggit_tableToMarkdown_(table) {
  var nRows = table.getNumRows();
  if (nRows === 0) return '';
  var grid = [], maxCols = 0, r, c;
  for (r = 0; r < nRows; r++) {
    var row = table.getRow(r);
    var nc = row.getNumCells();
    if (nc > maxCols) maxCols = nc;
    var cells = [];
    for (c = 0; c < nc; c++) cells.push(Ggit_mdCell_(row.getCell(c).getText()));
    grid.push(cells);
  }
  if (maxCols === 0) return '';
  function line(cells) {
    var out = [];
    for (var i = 0; i < maxCols; i++) out.push(i < cells.length ? cells[i] : '');
    return '| ' + out.join(' | ') + ' |';
  }
  var sep = [];
  for (c = 0; c < maxCols; c++) sep.push('---');
  var lines = [line(grid[0]), '| ' + sep.join(' | ') + ' |'];
  for (r = 1; r < nRows; r++) lines.push(line(grid[r]));
  return lines.join('\n');
}

/**
 * body 直下の要素を本文順に走査し、コミット用の正準テキストを組み立てる。
 *  - 段落 / リスト項目 … その要素テキストを1行として連結（getText 相当）。
 *  - 表 … Ggit_tableToMarkdown_ で Markdown のパイプ表へ。
 *  - その他（目次など）… 取得できればテキスト、無ければ空。
 * getChild は表も文書順で返すため、本文の並びが保たれる。
 */
function Ggit_bodyToText_(body) {
  var n = body.getNumChildren();
  var parts = [];
  for (var i = 0; i < n; i++) {
    var child = body.getChild(i);
    var t = child.getType();
    if (t === DocumentApp.ElementType.TABLE) {
      parts.push(Ggit_tableToMarkdown_(child.asTable()));
    } else if (t === DocumentApp.ElementType.PARAGRAPH) {
      parts.push(child.asParagraph().getText());
    } else if (t === DocumentApp.ElementType.LIST_ITEM) {
      parts.push(child.asListItem().getText());
    } else {
      try { parts.push(child.asText().getText()); } catch (_) { parts.push(''); }
    }
  }
  return parts.join('\n');
}

/**
 * タブ本文をコミット用スナップショット文字列としてシリアライズする（完全テキストベース）。
 * 書式は記録しない。表は Markdown のパイプ表としてテキスト化する（Ggit_bodyToText_）。
 *   { "v":2, "text": <本文の正準テキスト（表は Markdown）> }
 */
function Ggit_serializeTab(tab) {
  var body = tab.asDocumentTab().getBody();
  return JSON.stringify({ v: 2, text: Ggit_bodyToText_(body) });
}

/**
 * スナップショット文字列をタブ本文へ復元する（完全テキストベース）。
 * 書式は復元しない（旧 v:1 の fmt があっても無視）。表は Markdown テキストとして戻る。
 * 完全な書式・表の再現は、コミットに紐づく固定ネイティブ版（変更履歴）の「復元」で行う。
 */
function Ggit_restoreTab(tab, snapStr) {
  var body = tab.asDocumentTab().getBody();
  body.setText(Ggit_parseSnap(snapStr).text);
}
