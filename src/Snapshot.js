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
