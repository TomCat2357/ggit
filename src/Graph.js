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
 * store.objects 全体を描画用ノード配列へ整形する。
 * 子が親より前に来る順（おおむね新しい順）に並べる（レーン割当が前提とする向き）。
 * 各ノード: { id, parents:[...], refs:[ブックマーク名...], isWorking, isStash, message, timestamp, author }
 */
function Ggit_collectNodes(store) {
  var objects = store.objects || {};
  var working = store.working || null;
  var bm = store.bookmarks || {};

  // コミットID → そこを指すブックマーク名一覧
  var refsByCommit = {};
  for (var name in bm) {
    if (!bm.hasOwnProperty(name)) continue;
    var c = bm[name];
    (refsByCommit[c] = refsByCommit[c] || []).push(name);
  }

  var ids = [];
  for (var id in objects) { if (objects.hasOwnProperty(id)) ids.push(id); }

  var nodes = {};
  ids.forEach(function (id) {
    var o = objects[id];
    var parents = [];
    if (o.parent && objects.hasOwnProperty(o.parent)) parents.push(o.parent);
    if (o.parent2 && objects.hasOwnProperty(o.parent2)) parents.push(o.parent2);
    nodes[id] = {
      id: id,
      parents: parents,
      refs: refsByCommit[id] || [],
      isWorking: id === working,
      isStash: !!o.stash,
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
