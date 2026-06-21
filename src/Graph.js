/**
 * Graph.js — コミットDAGの収集と ASCII レーングラフ描画（純粋関数）。
 *
 * 要望2「ブランチを意識した表示」に対応する。A→B→C で B に戻って B→D と分岐すると
 * 2つの匿名ヘッド（葉）ができる。これを git log --graph 風の縦レーンで可視化する。
 *
 * すべて純粋関数（GAS ランタイム非依存）なので SelfTest でユニット検証できる。
 * UI（Menu.js）は Ggit_collectNodes → Ggit_graphLines の結果を等幅フォントで描画する。
 */

/**
 * 「可視ヘッド」= 子を持たない非スタッシュコミットIDの集合 { id:true } を返す純粋関数。
 * jj の匿名ヘッド（visible heads）に相当する。commit はブックマークを動かさないため、コミット
 * 直後に @ を別の場所へ移すと直前コミットを指すものが無くなるが、それでも「葉」はここでヘッドとして
 * 拾われ、到達ルート（Ggit_reachableIds）に含めることで孤立させない。
 * スタッシュ（側枝）は子として数えない／ヘッドにもしない（スタッシュ自体は別ルートで保持）。
 */
function Ggit_headIds(store) {
  var objects = store.objects || {};
  var hasChild = {};
  for (var cid in objects) {
    if (!objects.hasOwnProperty(cid)) continue;
    var c = objects[cid];
    if (c.stash) continue; // スタッシュの親参照は「子を持つ」に数えない
    if (c.parent && objects.hasOwnProperty(c.parent)) hasChild[c.parent] = true;
    if (c.parent2 && objects.hasOwnProperty(c.parent2)) hasChild[c.parent2] = true;
  }
  var heads = {};
  for (var id in objects) {
    if (!objects.hasOwnProperty(id)) continue;
    if (objects[id].stash) continue;
    if (!hasChild[id]) heads[id] = true;
  }
  return heads;
}

/**
 * ルート（現在地 @ / ブックマーク / スタッシュ / 可視ヘッド）から parent・parent2 を辿って到達
 * できるオブジェクトIDの集合 { id:true } を返す純粋関数。到達できないものが「孤立コミット」。
 * 可視ヘッド（子を持たない非スタッシュコミット＝匿名ヘッド）も常にルートに含めるため、commit→
 * 移動でブックマーク無しの葉を置き去りにしても孤立しない（jj の visible heads 相当）。
 * スタッシュはそれ自体がルート（一覧から pop/破棄できるよう常に保持する）。
 * 参照先が欠落しているエッジは辿らない（存在するオブジェクトのみ集合へ入れる）。
 */
function Ggit_reachableIds(store) {
  var objects = store.objects || {};
  var bm = store.bookmarks || {};
  var seen = {};
  var stack = [];
  function pushRoot(id) {
    if (id && objects.hasOwnProperty(id) && !seen[id]) { seen[id] = true; stack.push(id); }
  }
  pushRoot(store.working || null);
  for (var name in bm) { if (bm.hasOwnProperty(name)) pushRoot(bm[name]); }
  for (var sid in objects) { if (objects.hasOwnProperty(sid) && objects[sid].stash) pushRoot(sid); }
  var heads = Ggit_headIds(store);
  for (var hid in heads) { if (heads.hasOwnProperty(hid)) pushRoot(hid); } // 匿名ヘッドを保持

  while (stack.length) {
    var o = objects[stack.pop()];
    if (!o) continue;
    pushRoot(o.parent);
    pushRoot(o.parent2);
  }
  return seen;
}

/**
 * log に表示する（＝「繋がっている」）オブジェクトIDの集合 { id:true } を返す純粋関数。
 * 表示条件: ルートから到達可能（reachable）かつ本文を復元可能（canMaterialize）。
 * 例外として現在地 @ は壊れていても常に表示する（ユーザーが自分の居場所を見失わず、
 * 「修復」へ誘導できるようにするため）。
 * ここに含まれないものが「繋がりのなくなったコミット」＝非表示かつ掃除（Ggit_gcDisconnected）対象。
 */
function Ggit_displayableIds(store) {
  var objects = store.objects || {};
  var working = store.working || null;
  var reachable = Ggit_reachableIds(store);
  var show = {};
  for (var id in objects) {
    if (!objects.hasOwnProperty(id)) continue;
    if (id === working) { show[id] = true; continue; }      // 現在地は壊れていても常に表示
    if (!reachable[id]) continue;                            // 孤立 → 非表示
    if (!Ggit_canMaterialize(store, id)) continue;          // 壊れ（復元不能）→ 非表示
    show[id] = true;
  }
  return show;
}

/**
 * store.objects のうち「繋がっている」ものだけを描画用ノード配列へ整形する。
 * 孤立コミット・壊れたコミットは Ggit_displayableIds で除外される（現在地 @ は除外しない）。
 * 子が親より前に来る順（おおむね新しい順）に並べる（レーン割当が前提とする向き）。
 * 各ノード: { id, parents:[...], refs:[名...], isWorking, isStash, isHead, hasStash, isBroken, message, timestamp, author }
 */
function Ggit_collectNodes(store) {
  var objects = store.objects || {};
  var working = store.working || null;
  var bm = store.bookmarks || {};
  var show = Ggit_displayableIds(store);
  var heads = Ggit_headIds(store); // 可視ヘッド（子を持たない非スタッシュコミット＝破棄可能な葉）

  // コミットID → そこを指すブックマーク名一覧
  var refsByCommit = {};
  for (var name in bm) {
    if (!bm.hasOwnProperty(name)) continue;
    var c = bm[name];
    (refsByCommit[c] = refsByCommit[c] || []).push(name);
  }

  // コミットID → そこに付随するスタッシュがあるか（破棄時に一緒に消える旨を UI で警告するため）
  var stashByParent = {};
  for (var sk in objects) {
    if (!objects.hasOwnProperty(sk)) continue;
    var so = objects[sk];
    if (!so.stash) continue;
    if (so.parent) stashByParent[so.parent] = true;
    if (so.parent2) stashByParent[so.parent2] = true;
  }

  var ids = [];
  for (var id in objects) { if (objects.hasOwnProperty(id) && show[id]) ids.push(id); }

  var nodes = {};
  ids.forEach(function (id) {
    var o = objects[id];
    // 親も表示対象のときだけエッジを引く（壊れた/孤立した親へは線を繋がない＝その場で根になる）。
    var parents = [];
    if (o.parent && show[o.parent]) parents.push(o.parent);
    if (o.parent2 && show[o.parent2]) parents.push(o.parent2);
    nodes[id] = {
      id: id,
      parents: parents,
      refs: refsByCommit[id] || [],
      isWorking: id === working,
      isStash: !!o.stash,
      isHead: !!heads[id],
      hasStash: !!stashByParent[id],
      isBroken: !Ggit_canMaterialize(store, id),
      message: o.message,
      timestamp: o.timestamp,
      author: o.author
    };
  });

  // 子を先に出す位相順（Kahn）。準備済み（未出力の子が無い）ノードを timestamp 降順で選ぶ。
  var childCount = {};
  ids.forEach(function (id) { childCount[id] = 0; });
  ids.forEach(function (id) {
    nodes[id].parents.forEach(function (p) {
      if (childCount[p] !== undefined) childCount[p]++;
    });
  });

  function newer(a, b) {
    var ta = nodes[a].timestamp || '', tb = nodes[b].timestamp || '';
    if (ta !== tb) return ta > tb;   // ISO8601 は辞書順＝時刻順
    return a > b;                    // タイブレークは id
  }

  var remaining = {};
  ids.forEach(function (id) { remaining[id] = true; });
  var out = [];
  for (var step = 0; step < ids.length; step++) {
    var best = null;
    for (var rid in remaining) {
      if (!remaining.hasOwnProperty(rid)) continue;
      if (childCount[rid] !== 0) continue;
      if (best === null || newer(rid, best)) best = rid;
    }
    if (best === null) {            // 循環など想定外。残りをそのまま追加して打ち切る。
      for (var k in remaining) { if (remaining.hasOwnProperty(k)) out.push(nodes[k]); }
      return out;
    }
    out.push(nodes[best]);
    delete remaining[best];
    nodes[best].parents.forEach(function (p) {
      if (childCount[p] !== undefined) childCount[p]--;
    });
  }
  return out;
}

/** col より右側で最初の空きレーンを返す。無ければ末尾に追加して返す。 */
function Ggit_graphEmptyAfter(lanes, col) {
  for (var i = col + 1; i < lanes.length; i++) {
    if (lanes[i] === null) return i;
  }
  lanes.push(null);
  return lanes.length - 1;
}

/**
 * レーン遷移の接続行（| / \ _）を生成する。
 *  - lanes: その時点のレーン状態（'|' の判定に使う）。
 *  - col:   基準カラム。collapse の集約先 / sprout の起点。
 *  - dups:  col へ collapse する余剰カラム（>col）。'/' で描く（呼び出し側で既に null 化済み）。
 *  - extras: col から sprout する追加カラム（>col, マージ第2親）。'\\' で描く。縦線は描かない。
 */
function Ggit_graphConnector(lanes, col, dups, extras) {
  var W = lanes.length;
  for (var d = 0; d < dups.length; d++) if (dups[d] + 1 > W) W = dups[d] + 1;
  for (var e = 0; e < extras.length; e++) if (extras[e] + 1 > W) W = extras[e] + 1;

  var len = W > 0 ? 2 * W - 1 : 1;
  var a = [];
  for (var i = 0; i < len; i++) a[i] = ' ';

  // 継続する縦レーン（sprout で今作った extras カラムには縦線を引かない）
  for (var c = 0; c < lanes.length; c++) {
    if (lanes[c] !== null && extras.indexOf(c) < 0) a[2 * c] = '|';
  }

  // 余剰の子レーンを col へ collapse: '/'（必要なら間を '_' で繋ぐ）
  for (var k = 0; k < dups.length; k++) {
    var j = dups[k];
    a[2 * j - 1] = '/';
    for (var x = 2 * col + 1; x < 2 * j - 1; x++) { if (a[x] === ' ') a[x] = '_'; }
  }

  // 追加の親へ sprout: '\\'（必要なら間を '_' で繋ぐ）
  for (var k2 = 0; k2 < extras.length; k2++) {
    var ex = extras[k2];
    a[2 * col + 1] = '\\';
    for (var x2 = 2 * col + 2; x2 < 2 * ex; x2++) { if (a[x2] === ' ') a[x2] = '_'; }
  }

  return a.join('');
}

/**
 * ノード配列（Ggit_collectNodes の出力＝子が先）から ASCII レーングラフの行を生成する。
 * 返り値: [{ graph:'<等幅プレフィックス>', id:'<commitId>'|null, node:<node>|null }]
 *  - id 付きの行が commit 行（クリック対象）。id=null は接続行。
 *  - graph 文字列は 2*col 位置に各レーンの記号（'*' commit / '|' 縦 / 接続記号）を置く。
 */
function Ggit_graphLines(nodes) {
  var lanes = [];      // 各カラムが「次に描く commitId」（無ければ null）
  var rows = [];

  function firstLaneOf(id) {
    for (var i = 0; i < lanes.length; i++) if (lanes[i] === id) return i;
    return -1;
  }
  function firstEmpty() {
    for (var i = 0; i < lanes.length; i++) if (lanes[i] === null) return i;
    return -1;
  }

  for (var n = 0; n < nodes.length; n++) {
    var node = nodes[n];
    var id = node.id;
    var parents = node.parents || [];

    // この commit のカラム
    var col = firstLaneOf(id);
    if (col === -1) {
      col = firstEmpty();
      if (col === -1) { col = lanes.length; lanes.push(null); }
      lanes[col] = id;
    }

    // 複数の子が同じ親（この commit）へ合流＝余剰レーンを col へ collapse。
    // collapse は commit 行の「上」に描く（合流先コミットの直前で枝が閉じる）。
    var dups = [];
    for (var j = 0; j < lanes.length; j++) {
      if (j !== col && lanes[j] === id) dups.push(j);
    }
    if (dups.length) {
      for (var dd = 0; dd < dups.length; dd++) lanes[dups[dd]] = null; // 先に null 化
      rows.push({ graph: Ggit_graphConnector(lanes, col, dups, []), id: null, node: null });
    }

    // commit 行（col に '*'、他の非null レーンに '|'）
    var cells = [];
    for (var i = 0; i < lanes.length; i++) {
      cells.push(lanes[i] === null ? ' ' : (i === col ? '*' : '|'));
    }
    rows.push({ graph: cells.join(' '), id: id, node: node });

    // 前進: col→第1親、追加の親（マージ）→col の右の空きレーンへ sprout（commit 行の「下」）。
    var p0 = parents.length > 0 ? parents[0] : null;
    lanes[col] = p0;
    var extras = [];
    for (var pi = 1; pi < parents.length; pi++) {
      var ec = Ggit_graphEmptyAfter(lanes, col);
      lanes[ec] = parents[pi];
      extras.push(ec);
    }
    if (extras.length) {
      rows.push({ graph: Ggit_graphConnector(lanes, col, [], extras), id: null, node: null });
    }

    // 末尾の空きレーンを刈る
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
  }

  return rows;
}
