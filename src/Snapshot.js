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

/* ===================== 書式付きスナップショット（スコープ①: 記録＋復元） ===================== */
/*
 * payload に格納する「素材」を、プレーンテキストから構造化 JSON 文字列に拡張する。
 *   { "v":1, "text": <body.getText() と一致する全文>,
 *     "fmt": { "runs":[{s,e,a}], "paras":[{i,a}] } }
 * - text を diff/merge がそのまま射影（Ggit_plainOf）して使うため、プレーン処理は無改変。
 * - fmt を含めて比較することで「テキスト同一・書式のみ変更」を commit が検知できる。
 * - 圧縮/delta/コミットID は文字列処理なので、この JSON 文字列をそのまま流せる（無改修）。
 *
 * 後方互換: 旧 `.vcs`（payload が生プレーンテキスト）も Ggit_parseSnap / Ggit_plainOf が
 * 透過的に読めるため、既存ドキュメントを壊さない。
 *
 * フィデリティ境界（①）: 文字書式・段落書式のみ対応。表/画像/リストのグリフ・ネストは
 * 非対応（テキストとしては保持されるが書式は復元しない）。設計仕様書 §7.3 に整合。
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

/** オブジェクトに列挙可能キーが1つでもあるか。 */
function Ggit_hasKeys(o) {
  for (var k in o) { if (o.hasOwnProperty(k)) return true; }
  return false;
}

/** 文字列値の属性名→列挙型のマップ（①で復元対象とする段落系 enum のみ）。 */
function Ggit_enumFromString(attrKey, name) {
  var maps = {
    HEADING: DocumentApp.ParagraphHeading,
    HORIZONTAL_ALIGNMENT: DocumentApp.HorizontalAlignment
  };
  var e = maps[attrKey];
  if (!e) return null;
  var v = e[name];
  return v === undefined ? null : v;
}

/**
 * getAttributes() の戻り値を JSON 安全な形へ正規化する。
 * - null/undefined は捨てる（未設定属性でストアを肥大させない）。
 * - 文字列/数値/真偽はそのまま。
 * - それ以外（列挙型など）は { __enum: <toString> } で名前を保持する。
 */
function Ggit_normAttrs(attrs) {
  var out = {};
  for (var k in attrs) {
    if (!attrs.hasOwnProperty(k)) continue;
    var v = attrs[k];
    if (v === null || v === undefined) continue;
    var tv = typeof v;
    if (tv === 'string' || tv === 'number' || tv === 'boolean') {
      out[k] = v;
    } else {
      out[k] = { __enum: String(v) };
    }
  }
  return out;
}

/** 正規化属性を setAttributes() 適用可能な形へ戻す。復元不能な enum は捨てる（①の境界）。 */
function Ggit_denormAttrs(obj) {
  var out = {};
  for (var k in obj) {
    if (!obj.hasOwnProperty(k)) continue;
    var v = obj[k];
    if (v && typeof v === 'object' && v.__enum !== undefined) {
      var e = Ggit_enumFromString(k, v.__enum);
      if (e !== null) out[k] = e; // 未対応 enum は適用しない
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** body の段落系要素（Paragraph / ListItem）を本文順で返す。 */
function Ggit_paraElements(body) {
  var out = [];
  var n = body.getNumChildren();
  for (var i = 0; i < n; i++) {
    var c = body.getChild(i);
    var t = c.getType();
    if (t === DocumentApp.ElementType.PARAGRAPH || t === DocumentApp.ElementType.LIST_ITEM) {
      out.push(c);
    }
  }
  return out;
}

/**
 * タブ本文を書式付きスナップショット文字列としてシリアライズする。
 * 文字書式は body.editAsText() の属性区間、段落書式は段落系要素の属性として取得する。
 */
function Ggit_serializeTab(tab) {
  var body = tab.asDocumentTab().getBody();
  var text = body.getText();

  var runs = [];
  if (text.length > 0) {
    var et = body.editAsText();
    var idx = et.getTextAttributeIndices();
    for (var i = 0; i < idx.length; i++) {
      var s = idx[i];
      var e = (i + 1 < idx.length) ? idx[i + 1] - 1 : text.length - 1; // 終端は inclusive
      if (e < s) continue;
      runs.push({ s: s, e: e, a: Ggit_normAttrs(et.getAttributes(s)) });
    }
  }

  var paras = [];
  var pels = Ggit_paraElements(body);
  for (var j = 0; j < pels.length; j++) {
    paras.push({ i: j, a: Ggit_normAttrs(pels[j].getAttributes()) });
  }

  return JSON.stringify({ v: 1, text: text, fmt: { runs: runs, paras: paras } });
}

/**
 * スナップショット文字列をタブ本文へ復元する（テキスト＋書式）。
 * setText 後に段落属性→文字属性の順で再適用する（段落の NamedStyle が文字属性を
 * 上書きしうるため、文字属性を後に当てて明示書式を優先する）。
 */
function Ggit_restoreTab(tab, snapStr) {
  var body = tab.asDocumentTab().getBody();
  var snap = Ggit_parseSnap(snapStr);
  var text = snap.text;
  body.setText(text);
  if (!snap.fmt) return; // 旧プレーン payload はテキストのみ復元。

  var pels = Ggit_paraElements(body);
  var paras = snap.fmt.paras || [];
  for (var j = 0; j < paras.length; j++) {
    var p = paras[j];
    if (p.i < pels.length) {
      var pa = Ggit_denormAttrs(p.a);
      if (Ggit_hasKeys(pa)) pels[p.i].setAttributes(pa);
    }
  }

  if (text.length > 0) {
    var et = body.editAsText();
    var runs = snap.fmt.runs || [];
    for (var k = 0; k < runs.length; k++) {
      var r = runs[k];
      var ra = Ggit_denormAttrs(r.a);
      if (Ggit_hasKeys(ra) && r.e >= r.s) et.setAttributes(r.s, r.e, ra);
    }
  }
}
