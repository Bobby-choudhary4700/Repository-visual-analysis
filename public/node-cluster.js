// The app's loading animation: a slowly turning 3D cluster of files wired to each other.
// Nodes join and leave over time, so the cluster grows and shrinks while something loads.
//
// A plain script rather than a module, so index.html can run it before the app's bundle
// has loaded (the start-up screen), and the app can run the same thing later through
// src/NodeLoader.tsx. It defines one global, `rvaNodeCluster(canvas, options)`, which
// starts drawing into the canvas and returns a function that stops it.
(function () {
  var COLORS = ["#38bdf8", "#818cf8", "#f472b6", "#34d399", "#fbbf24"];
  var FADE = 0.7; // seconds for a node to grow in or shrink away

  function ease(k) {
    return k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k);
  }

  /**
   * options.size: the canvas's CSS size in pixels (it is square).
   * options.wire: the wires' colour as "r, g, b" (default a light blue for dark screens).
   * options.light: true on a light background (softer glow, darker wires).
   */
  window.rvaNodeCluster = function (canvas, options) {
    options = options || {};
    var size = options.size || 168;
    var light = !!options.light;
    var wire = options.wire || (light ? "15, 23, 42" : "148, 197, 255");
    var small = size < 48;
    // Small ones keep fewer, bigger nodes, so they still read as a cluster at icon size.
    var minNodes = small ? 3 : 4;
    var maxNodes = small ? 7 : 22;
    var spread = size * (small ? 0.34 : 0.345);
    var nodeScale = small ? size * 0.065 : size * 0.0286;
    var lineWidth = small ? Math.max(0.7, size / 22) : 1.3;
    var glow = small ? 0 : light ? 4 : 12;

    var ctx = canvas.getContext("2d");
    if (!ctx) return function () {};
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var hub = { x: 0, y: 0, z: 0, r: small ? 1.25 : 1.5, color: COLORS[0], born: -FADE, dying: Infinity };
    var nodes = [hub];
    var lastChange = 0;
    var colorAt = 1;

    function life(n, t) {
      return ease((t - n.born) / FADE) * (1 - ease((t - n.dying) / FADE));
    }

    function candidate() {
      // A point in a shell around the hub, so nodes don't pile up in the middle.
      var u = Math.random() * 2 - 1;
      var a = Math.random() * Math.PI * 2;
      var d = small ? 0.8 + Math.random() * 0.2 : 0.45 + Math.random() * 0.55;
      var s = Math.sqrt(1 - u * u);
      return { x: Math.cos(a) * s * d, y: u * d, z: Math.sin(a) * s * d };
    }

    function spawn(t) {
      // The best of a few tries: the one furthest from the nodes already there, so the
      // cluster spreads out instead of clumping.
      var best = null;
      var bestGap = -1;
      for (var c = 0; c < 10; c++) {
        var p = candidate();
        var gap = Infinity;
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i];
          gap = Math.min(gap, (p.x - n.x) ** 2 + (p.y - n.y) ** 2 + (p.z - n.z) ** 2);
        }
        if (gap > bestGap) {
          best = p;
          bestGap = gap;
        }
      }
      nodes.push({
        x: best.x,
        y: best.y,
        z: best.z,
        r: small ? 1 : 0.8 + Math.random() * 0.5,
        color: COLORS[colorAt++ % COLORS.length],
        born: t,
        dying: Infinity,
      });
    }

    function step(t) {
      // How many nodes the cluster wants right now, rising and falling between the limits.
      var mid = (minNodes + maxNodes) / 2;
      var want = Math.round(mid + (maxNodes - mid) * Math.sin(t * 0.55 - 1.2));
      var alive = nodes.filter(function (n) {
        return n.dying === Infinity;
      });
      if (t - lastChange > 0.12) {
        if (alive.length < want) {
          spawn(t);
          lastChange = t;
        } else if (alive.length > want) {
          var leaving = alive.find(function (n) {
            return n !== hub;
          });
          if (leaving) leaving.dying = t;
          lastChange = t;
        }
      }
      nodes = nodes.filter(function (n) {
        return t - n.dying < FADE;
      });
    }

    function draw(t) {
      var rot = t * 0.6;
      var tilt = 0.45 + Math.sin(t * 0.3) * 0.15;
      var cy = Math.cos(rot),
        sy = Math.sin(rot),
        cx = Math.cos(tilt),
        sx = Math.sin(tilt);
      var half = size / 2;
      var pts = nodes.map(function (n) {
        var x1 = n.x * cy - n.z * sy;
        var z1 = n.x * sy + n.z * cy;
        var y2 = n.y * cx - z1 * sx;
        var z2 = n.y * sx + z1 * cx;
        var p = 2.6 / (2.6 + z2); // perspective
        return { n: n, x: half + x1 * p * spread, y: half + y2 * p * spread, z: z2, p: p, a: life(n, t) };
      });

      ctx.clearRect(0, 0, size, size);

      // Each node wires to its two nearest neighbours.
      var pairs = new Set();
      for (var i = 0; i < nodes.length; i++) {
        var a = nodes[i];
        var near = [];
        for (var j = 0; j < nodes.length; j++) {
          if (i === j) continue;
          var b = nodes[j];
          near.push([(a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2, j]);
        }
        near.sort(function (m, k) {
          return m[0] - k[0];
        });
        for (var q = 0; q < Math.min(2, near.length); q++) {
          var o = near[q][1];
          pairs.add(i < o ? i * 64 + o : o * 64 + i);
        }
      }
      ctx.lineWidth = lineWidth;
      pairs.forEach(function (key) {
        var pa = pts[Math.floor(key / 64)],
          pb = pts[key % 64];
        var depth = 0.55 + 0.45 * (1 - (pa.z + pb.z + 2) / 4);
        var alpha = Math.min(pa.a, pb.a) * depth * (light ? 0.45 : 0.6);
        if (alpha <= 0.01) return;
        ctx.strokeStyle = "rgba(" + wire + ", " + alpha + ")";
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      });

      // Far nodes first, so near ones sit on top.
      pts.sort(function (m, k) {
        return k.z - m.z;
      });
      for (var w = 0; w < pts.length; w++) {
        var pt = pts[w];
        if (pt.a <= 0.01) continue;
        var r = pt.n.r * nodeScale * pt.p * (0.4 + 0.6 * pt.a);
        ctx.globalAlpha = pt.a * (0.5 + 0.5 * (1 - (pt.z + 1) / 2));
        ctx.shadowColor = pt.n.color;
        ctx.shadowBlur = glow;
        ctx.fillStyle = pt.n.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        if (!small) {
          // A small highlight makes each node read as a ball.
          ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
          ctx.beginPath();
          ctx.arc(pt.x - r * 0.3, pt.y - r * 0.3, r * 0.35, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }

    // Start with a small cluster already in place, so the first frames aren't empty.
    for (var k = 0; k < Math.max(2, Math.round(minNodes * 1.5)); k++) spawn(-FADE + k * 0.08);

    var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      draw(1);
      return function () {};
    }
    var stopped = false;
    var start = performance.now();
    function frame(now) {
      if (stopped || !canvas.isConnected) return;
      var t = (now - start) / 1000;
      step(t);
      draw(t);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    return function () {
      stopped = true;
    };
  };
})();
