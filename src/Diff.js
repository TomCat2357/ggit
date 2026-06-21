/**
 * Diff.js — テキスト差分（行ベース）。
 *
 * 設計仕様書 §7.1: diff-match-patch でタブ本文どうしの差分を算出する。
 * Log 画面は左右2カラム（A|B）/上下 の2レイアウトで表示するため、ここでは行単位の差分を
 * 構造データ（{ lines:[{t,s}] }）で返し、レイアウト描画はクライアント側に委ねる
 * （レイアウト切替でサーバを再呼び出ししないで済む）。
 */

/** chunk を行配列へ分解。行モードの chunk は各行が '\n' 終端なので末尾の空要素は落とす。 */
function Ggit_splitKeepLines_(chunk) {
  if (chunk === '') return [];
  var arr = chunk.split('\n');
  if (arr.length && arr[arr.length - 1] === '') arr.pop(); // 末尾 '\n' 由来の空要素を除去
  return arr;
}

/**
 * 2テキストの行単位差分を返す。
 *  返り値: { lines: [ { t:'eq'|'del'|'ins', s:<1行> }, ... ] }
 *   - 'eq'  … 両者共通の行
 *   - 'del' … A（旧）側のみ＝削除
 *   - 'ins' … B（新）側のみ＝追加
 * diff-match-patch の行モード（linesToChars → diff_main → charsToLines）で行粒度にする。
 */
function Ggit_diffLines(textA, textB) {
  var a = textA == null ? '' : String(textA);
  var b = textB == null ? '' : String(textB);
  // 末尾行に改行が無いと「最終行」と「最終行＋改行」が別行扱いになり、末尾への追加/削除が
  // 直前行の変更として誤検出される。両者の末尾を改行で正規化して回避する（末尾の余分な
  // 空要素は Ggit_splitKeepLines_ が落とす）。
  if (a !== '' && a.charAt(a.length - 1) !== '\n') a += '\n';
  if (b !== '' && b.charAt(b.length - 1) !== '\n') b += '\n';

  var dmp = new diff_match_patch();
  var lc = dmp.diff_linesToChars_(a, b);
  var diffs = dmp.diff_main(lc.chars1, lc.chars2, false);
  dmp.diff_charsToLines_(diffs, lc.lineArray);

  var lines = [];
  for (var i = 0; i < diffs.length; i++) {
    var op = diffs[i][0]; // DIFF_DELETE(-1) / DIFF_EQUAL(0) / DIFF_INSERT(1)
    var t = op === DIFF_DELETE ? 'del' : (op === DIFF_INSERT ? 'ins' : 'eq');
    var segs = Ggit_splitKeepLines_(diffs[i][1]);
    for (var j = 0; j < segs.length; j++) lines.push({ t: t, s: segs[j] });
  }
  return { lines: lines };
}

/** 2コミット間の行単位差分（UIダイアログから google.script.run で呼ばれる）。 */
function Ggit_diffCommitsLines(idA, idB) {
  var store = Ggit_storeLoad();
  // diff はプレーンテキスト対象（設計仕様書 §7.3）。スナップショットから text を射影する。
  var a = Ggit_plainOf(Ggit_materialize(store, idA));
  var b = Ggit_plainOf(Ggit_materialize(store, idB));
  return Ggit_diffLines(a, b);
}
