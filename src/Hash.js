/**
 * Hash.js — コミットID（SHA-256 短縮ハッシュ）。
 *
 * 設計仕様書 §5.1: 本文シリアライズの SHA-256 を短縮してコミットIDとする。
 */

/** 文字列の SHA-256 を小文字 hex で返す。 */
function Ggit_sha256Hex(input) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, input, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256; // byte は符号付きのため 0..255 に正規化
    var h = b.toString(16);
    hex += (h.length === 1 ? '0' : '') + h;
  }
  return hex;
}

/**
 * コミットIDを算出する。既存IDと衝突する短縮形は桁を伸ばして一意化する。
 * 入力は branch / parent / timestamp / 本文全文を連結したもの。
 */
function Ggit_commitId(store, branch, parent, timestamp, fullText) {
  var hex = Ggit_sha256Hex(branch + '\n' + (parent || '') + '\n' + timestamp + '\n' + fullText);
  for (var len = 7; len < hex.length; len++) {
    var cand = hex.substring(0, len);
    if (!store.objects[cand]) return cand;
  }
  return hex;
}
