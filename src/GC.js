/**
 * GC.js — 「掃除」: 繋がりのなくなったコミットの削除（ガベージコレクト）。
 *
 * 対象は Ggit_displayableIds の補集合、すなわち:
 *  - 孤立コミット: 現在地 @ / ブックマーク / スタッシュのどこからも辿れない。
 *  - 壊れたコミット: 親方向の連鎖が full に届かず本文を復元できない（例: 破棄された
 *    5653e7bf を親に持つ）。
 * いずれも DAG 上「繋がり」が切れており、クリックしても goto/diff が失敗するため掃除する。
 *
 * 安全策: 現在地 @ は壊れていても削除しない（内容は作業タブに生きており「修復」で立て直せる）。
 * 削除後は生存オブジェクトの欠落参照（parent/parent2）を根へ切り離し、消えたコミットを指す
 * ブックマークも取り除いて整合を保つ。
 */

/**
 * 繋がりのなくなったコミットを掃除する純粋関数（store を破壊的に更新）。保存は呼び出し側。
 * 戻り値: { removed:[id...], orphans, broken, workingBroken }。
 *  - orphans: 削除のうち孤立（到達不能）だった件数。
 *  - broken : 削除のうち壊れ（復元不能・到達可能）だった件数。
 *  - workingBroken: 掃除後も現在地 @ が壊れている（＝要修復）か。
 */
function Ggit_gcDisconnectedInStore(store) {
  var objects = store.objects || {};
  var working = store.working || null;
  var reachable = Ggit_reachableIds(store);
  var show = Ggit_displayableIds(store); // 表示対象＝残すもの（現在地 @ を含む）

  var removed = [], orphans = 0, broken = 0;
  for (var id in objects) {
    if (!objects.hasOwnProperty(id)) continue;
    if (show[id]) continue;             // 繋がっている（＝残す。現在地 @ もここで残る）
    removed.push(id);
    if (!reachable[id]) orphans++; else broken++;
  }
  for (var i = 0; i < removed.length; i++) delete objects[removed[i]];

  // 生存オブジェクトの欠落参照を根へ切り離し、消えたコミットを指すブックマークを除去する。
  Ggit_pruneDanglingRefs_(store);

  var workingBroken = !!(working && objects.hasOwnProperty(working) && !Ggit_canMaterialize(store, working));
  return { removed: removed, orphans: orphans, broken: broken, workingBroken: workingBroken };
}

/**
 * 「掃除」エントリポイント（log モーダルの掃除ボタン / メニューから呼ぶ）。
 * 繋がりのなくなったコミットを削除して `.vcs` を保存する。
 * 戻り値: { removed, orphans, broken, workingBroken }（removed は件数）。
 */
function Ggit_gcDisconnected() {
  var doc = DocumentApp.getActiveDocument();
  var store = Ggit_storeLoad(doc);
  var r = Ggit_gcDisconnectedInStore(store);
  if (r.removed.length) Ggit_storeSave(doc, store);
  return {
    removed: r.removed.length, orphans: r.orphans, broken: r.broken,
    workingBroken: r.workingBroken
  };
}

/** 繋がりのなくなったコミット件数（掃除ボタンのバッジ用）。{ total, orphans, broken } を返す。 */
function Ggit_countDisconnected(store) {
  var objects = store.objects || {};
  var reachable = Ggit_reachableIds(store);
  var show = Ggit_displayableIds(store);
  var orphans = 0, broken = 0;
  for (var id in objects) {
    if (!objects.hasOwnProperty(id) || show[id]) continue;
    if (!reachable[id]) orphans++; else broken++;
  }
  return { total: orphans + broken, orphans: orphans, broken: broken };
}

/**
 * 宙ぶらりんな参照を整える純粋関数（store を破壊的に更新）。掃除・破棄の後始末で共用する。
 *  - 生存オブジェクトが欠落 ID を parent/parent2 に指していたら根（null）へ切り離す。
 *  - 消えたコミットを指すブックマークを取り除く。
 */
function Ggit_pruneDanglingRefs_(store) {
  var objects = store.objects || {};
  for (var sid in objects) {
    if (!objects.hasOwnProperty(sid)) continue;
    var o = objects[sid];
    if (o.parent && !objects.hasOwnProperty(o.parent)) o.parent = null;
    if (o.parent2 && !objects.hasOwnProperty(o.parent2)) o.parent2 = null;
  }
  var bm = store.bookmarks || {};
  for (var name in bm) {
    if (bm.hasOwnProperty(name) && !objects.hasOwnProperty(bm[name])) delete bm[name];
  }
}

/** id を parent もしくは parent2 に持つ「非スタッシュ」コミット（＝実後続）が存在するか。 */
function Ggit_hasNonStashChild_(objects, id) {
  for (var cid in objects) {
    if (!objects.hasOwnProperty(cid)) continue;
    var c = objects[cid];
    if (c.stash) continue;
    if (c.parent === id || c.parent2 === id) return true;
  }
  return false;
}

/** id を parent もしくは parent2 に持つスタッシュ（仮コミット）の ID 一覧。 */
function Ggit_stashChildrenOf_(objects, id) {
  var out = [];
  for (var cid in objects) {
    if (!objects.hasOwnProperty(cid)) continue;
    var c = objects[cid];
    if (c.stash && (c.parent === id || c.parent2 === id)) out.push(cid);
  }
  return out;
}

/** id を指すブックマークが1つでもあるか。 */
function Ggit_isBookmarked_(store, id) {
  var bm = store.bookmarks || {};
  for (var name in bm) {
    if (bm.hasOwnProperty(name) && bm[name] === id) return true;
  }
  return false;
}

/**
 * 葉（可視ヘッド）コミットを破棄し、その枝だけを根方向へ刈る純粋関数（store を破壊的に更新）。
 * 戻り値: { removed:[id...], droppedStashes:[id...] }。保存は呼び出し側。
 *
 * 仕様:
 *  - 対象 id は「実後続（非スタッシュの子）を持たない葉」でなければならない（実枝があると壊すため）。
 *    スタッシュは「子」に数えず（可視ヘッド判定 Ggit_headIds と整合）、刈る枝に付随するスタッシュは
 *    一緒に破棄する。スタッシュ自体・現在地 @ は破棄不可。
 *  - id を消したのち親方向へ遡り、その祖先が「現在地 @ でも・ブックマーク先でも・実後続を持つ
 *    （他の実枝が乗る）でもない」間だけ続けて刈る。共有点（分岐元）で止まる。
 */
function Ggit_abandonInStore(store, id) {
  var objects = store.objects || {};
  var victim = objects[id];
  if (!victim) throw new Error('コミットが見つかりません: ' + id);
  if (victim.stash) {
    throw new Error('スタッシュは破棄できません。スタッシュ一覧の「破棄」を使ってください。');
  }
  if (store.working === id) {
    throw new Error('現在地 @ は破棄できません。先に別のコミットへ移動してください。');
  }
  if (Ggit_hasNonStashChild_(objects, id)) {
    throw new Error('このコミットには後続があります。枝の先端（葉）から破棄してください。');
  }

  var removed = [];
  var droppedStashes = [];
  var cur = id;
  while (cur) {
    var o = objects[cur];
    if (!o || o.stash) break;                          // スタッシュ側枝には入らない
    if (cur !== id) {
      if (store.working === cur) break;                // 現在地は刈らない
      if (Ggit_isBookmarked_(store, cur)) break;       // ブックマーク先は刈らない
      if (Ggit_hasNonStashChild_(objects, cur)) break; // 他の実枝が乗る共有点で止まる
    }
    // この枝に付随するスタッシュも一緒に破棄する（親を失って壊れるのを防ぐ）。
    var sids = Ggit_stashChildrenOf_(objects, cur);
    for (var si = 0; si < sids.length; si++) {
      delete objects[sids[si]];
      droppedStashes.push(sids[si]);
    }
    var parent = o.parent;
    delete objects[cur];
    removed.push(cur);
    cur = parent;
  }
  Ggit_pruneDanglingRefs_(store);
  return { removed: removed, droppedStashes: droppedStashes };
}

/**
 * 「破棄」エントリポイント（log モーダルのコミット行「破棄」から呼ぶ）。
 * 指定した葉コミットの枝を刈って `.vcs` を保存する（付随スタッシュも一緒に破棄）。
 * 戻り値: { removed, ids, droppedStashes }（removed・droppedStashes は件数）。
 */
function Ggit_abandonCommit(id) {
  var doc = DocumentApp.getActiveDocument();
  var store = Ggit_storeLoad(doc);
  var r = Ggit_abandonInStore(store, id);
  if (r.removed.length || r.droppedStashes.length) Ggit_storeSave(doc, store);
  return { removed: r.removed.length, ids: r.removed, droppedStashes: r.droppedStashes.length };
}

/**
 * id とその全子孫（parent/parent2 を下方向へ辿って到達するコミット＋付随スタッシュ）の集合
 * { id:true } を返す純粋関数。「枝の根本を消したら全部消える」削除（Ggit_deleteSubtree）の対象。
 */
function Ggit_subtreeIds(store, id) {
  var objects = store.objects || {};
  var inSet = {};
  var stack = [id];
  inSet[id] = true;
  while (stack.length) {
    var cur = stack.pop();
    for (var cid in objects) {
      if (!objects.hasOwnProperty(cid) || inSet[cid]) continue;
      var c = objects[cid];
      if (c.parent === cur || c.parent2 === cur) { inSet[cid] = true; stack.push(cid); }
    }
  }
  return inSet;
}

/**
 * id とその全子孫だけを削除する純粋関数（store を破壊的に更新）。保存は呼び出し側。
 * 戻り値: { removed:[id...], droppedStashes:[id...] }。
 *
 * 仕様:
 *  - 対象 id は通常コミット（スタッシュは不可）。
 *  - mainAnc は Ggit_ancestorSet(store, main)（main 無しなら {}）。mainAnc[id] のとき＝main が id の
 *    子孫に含まれる（削除すると main ブックマークが消える）ため不可。DAG の性質上「id が main の祖先で
 *    ない ⇒ id の子孫も main の祖先になり得ない」ので、保護判定は id 1点で足りる（parent2 経由のマージも
 *    Ggit_ancestorSet が辿るため、側枝としてマージされた根本も正しく保護される）。
 *  - 削除は id＋子孫のみ（下方向だけ）。上流（祖先）は一切刈らない＝「選んだコミットとその子孫だけ」が消える。
 *  - id の子孫に付随するスタッシュも一緒に破棄し、消えたコミットを指すブックマーク等は後始末する。
 */
function Ggit_deleteSubtreeInStore(store, id, mainAnc) {
  var objects = store.objects || {};
  var victim = objects[id];
  if (!victim) throw new Error('コミットが見つかりません: ' + id);
  if (victim.stash) {
    throw new Error('スタッシュは削除できません。スタッシュ一覧の「破棄」を使ってください。');
  }
  if (mainAnc && mainAnc[id]) {
    throw new Error('main ブックマークが消えるため削除できません。');
  }

  var sub = Ggit_subtreeIds(store, id);
  var removed = [], droppedStashes = [];
  for (var did in sub) {
    if (!sub.hasOwnProperty(did) || !objects[did]) continue;
    if (objects[did].stash) droppedStashes.push(did); else removed.push(did);
    delete objects[did];
  }

  Ggit_pruneDanglingRefs_(store);
  return { removed: removed, droppedStashes: droppedStashes };
}

/**
 * 「枝を破棄」エントリポイント（log モーダルのコミット行「枝を破棄」から呼ぶ）。
 * 指定コミットとその全子孫を削除して `.vcs` を保存する（付随スタッシュも一緒に破棄）。
 * 削除対象の枝に現在地 @ が含まれるときは、@ を枝の根本の親へ移し、作業タブ本文もその版へ
 * 書き換えてから削除する（要望：「全部消える」体験。未コミット内容は枝ごと破棄するためスタッシュしない）。
 * 戻り値: { removed, ids, droppedStashes }（removed・droppedStashes は件数）。
 */
function Ggit_deleteSubtree(id) {
  var doc = DocumentApp.getActiveDocument();
  var tab = doc.getActiveTab();
  var meta = Ggit_metaTab(doc);
  if (meta && tab.getId() === meta.getId()) {
    throw new Error('.vcs メタタブ上では削除できません。対象のタブを選択してください。');
  }

  var store = Ggit_storeLoad(doc);
  var objects = store.objects || {};
  if (!objects[id]) throw new Error('コミットが見つかりません: ' + id);
  if (objects[id].stash) {
    throw new Error('スタッシュは削除できません。スタッシュ一覧の「破棄」を使ってください。');
  }

  var mc = store.bookmarks && store.bookmarks['main'];
  var mainAnc = mc ? Ggit_ancestorSet(store, mc) : {};
  if (mainAnc[id]) throw new Error('main ブックマークが消えるため削除できません。');

  var sub = Ggit_subtreeIds(store, id);
  if (store.working && sub[store.working]) {
    // @ が削除対象の枝に含まれる → 根本の親（生存側）へ移し、タブ本文も差し替える。
    var landing = (objects[id].parent && !sub[objects[id].parent]) ? objects[id].parent
                : (mc && !sub[mc]) ? mc
                : null;
    if (!landing) {
      throw new Error('削除後の現在地の移動先がありません。先に goto で枝の外へ移動してください。');
    }
    Ggit_restoreTab(tab, Ggit_materialize(store, landing)); // テキスト＋書式を入れ替え
    store.working = landing;                                 // ※スタッシュはしない（枝ごと破棄）
  }

  var r = Ggit_deleteSubtreeInStore(store, id, mainAnc);
  Ggit_storeSave(doc, store);
  return { removed: r.removed.length, ids: r.removed, droppedStashes: r.droppedStashes.length };
}
