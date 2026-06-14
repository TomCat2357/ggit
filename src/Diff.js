/**
 * Diff.js — テキスト差分表示。
 *
 * 設計仕様書 §7.1: diff-match-patch でタブ本文どうしの差分を算出し着色表示する。
 */

/** 2テキストの差分を着色HTML（diff_prettyHtml）で返す。 */
function Ggit_diffHtml(textA, textB) {
  var dmp = new diff_match_patch();
  var diffs = dmp.diff_main(textA, textB);
  dmp.diff_cleanupSemantic(diffs);
  return dmp.diff_prettyHtml(diffs);
}

/** 2コミット間の差分HTML（UIダイアログから google.script.run で呼ばれる）。 */
function Ggit_diffCommitsHtml(idA, idB) {
  var store = Ggit_storeLoad();
  // diff はプレーンテキスト対象（設計仕様書 §7.3）。スナップショットから text を射影する。
  var a = Ggit_plainOf(Ggit_materialize(store, idA));
  var b = Ggit_plainOf(Ggit_materialize(store, idB));
  return Ggit_diffHtml(a, b);
}
