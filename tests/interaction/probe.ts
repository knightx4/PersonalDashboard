/**
 * The measuring half of the phone checks, run inside the page.
 *
 * It is a string rather than a function so that nothing between here and the
 * browser can rewrite it: tsx and vitest both transform functions, and a
 * helper they add (`__name`) does not exist in the page. Evaluated as
 * `(PROBE)(options)`, it returns plain data that ./checks.ts turns into
 * findings.
 *
 * What it reads, at the viewport it is given:
 *
 * - sideways: the document's scroll width against its client width, and the
 *   deepest elements reaching past either edge.
 * - targets: every visible pressable thing (links, buttons, form fields,
 *   summaries and the ARIA roles that press) whose box, with its label's box
 *   and any absolutely placed ::before or ::after that widens it, is under
 *   the minimum on either side. A link inside a run of text is exempt, as
 *   WCAG exempts it: a sentence cannot be laid out in 44-pixel words.
 * - dock: every visible pressable thing held in place by `position: fixed`
 *   or `sticky` (its own or an ancestor's) that the dock covers, at the top
 *   of the page and at the bottom. The shell's dock is used when the surface
 *   draws the shell; otherwise one is laid where the shell puts it, at
 *   --dock-h and --z-chrome, and "covers" means the dock is what a press at
 *   that point would land on. So a dialog over the dock passes and a bar
 *   pinned to bottom: 0 under it fails. Things in the page's flow are left
 *   alone: the shell's room under the page (pb-[calc(var(--dock-h)+…)])
 *   clears them, and the gallery does not draw that room.
 * - contrast: every visible run of text against the ground it is painted
 *   over, worked out by compositing the backgrounds of its ancestors (a
 *   gradient counts as its worst stop), with the text's alpha and the
 *   opacity between them. 4.5:1, or 3:1 for large text and for text in an
 *   ink check:contrast holds at 3:1 as decoration (the ghost inks).
 *   Text over an image cannot be measured and is counted, not failed.
 */
export const PROBE = String.raw`(function (options) {
  var MIN = options.minTarget;
  var doc = document.documentElement;
  var vw = doc.clientWidth;
  var vh = doc.clientHeight;

  function visible(el) {
    var r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    for (var a = el; a && a.nodeType === 1; a = a.parentElement) {
      var cs = getComputedStyle(a);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
      if (Number(cs.opacity) === 0) return false;
      if (cs.clipPath && cs.clipPath.indexOf('inset(50%') === 0) return false;
      if (cs.clip && cs.clip.indexOf('rect(0') === 0 && cs.position === 'absolute') return false;
    }
    return true;
  }

  function describe(el) {
    var name = el.tagName.toLowerCase();
    if (el.id) name += '#' + el.id;
    var role = el.getAttribute('role');
    if (role) name += '[role=' + role + ']';
    var label = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || (el.textContent || '');
    label = label.replace(/\s+/g, ' ').trim();
    if (label.length > 40) label = label.slice(0, 39) + '…';
    return label ? name + ' "' + label + '"' : name;
  }

  // ---- sideways ----
  var scrollWidth = Math.max(doc.scrollWidth, document.body ? document.body.scrollWidth : 0);
  var over = [];
  var all = document.body ? document.body.querySelectorAll('*') : [];
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right <= vw + 1 && r.left >= -1) continue;
    // Deepest only: skip one whose child also reaches past the edge.
    var child = false;
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
      var cr = c.getBoundingClientRect();
      if (cr.width > 0 && (cr.right > vw + 1 || cr.left < -1)) { child = true; break; }
    }
    if (child) continue;
    over.push({ what: describe(el), left: Math.round(r.left), right: Math.round(r.right) });
  }
  var sideways = { viewport: vw, scrollWidth: scrollWidth, scrolls: scrollWidth > vw + 1, over: over.slice(0, 8) };

  // ---- pressables ----
  var PRESSABLE = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=radio], [role=switch], [role=option]';
  var pressables = Array.prototype.filter.call(document.querySelectorAll(PRESSABLE), function (el) {
    if (el.closest('[aria-hidden=true], [inert]')) return false;
    return true;
  });

  function px(value) {
    var n = parseFloat(value);
    return isNaN(n) ? null : n;
  }

  function box(el) {
    var r = el.getBoundingClientRect();
    var b = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    function grow(o) {
      b.left = Math.min(b.left, o.left); b.top = Math.min(b.top, o.top);
      b.right = Math.max(b.right, o.right); b.bottom = Math.max(b.bottom, o.bottom);
    }
    // A label is part of its control's target.
    if (el.labels) for (var i = 0; i < el.labels.length; i++) if (visible(el.labels[i])) grow(el.labels[i].getBoundingClientRect());
    // An absolutely placed pseudo-element widens the target (a hit area).
    if (getComputedStyle(el).position !== 'static') {
      ['::before', '::after'].forEach(function (which) {
        var ps = getComputedStyle(el, which);
        if (ps.content === 'none' || ps.content === 'normal' || ps.position !== 'absolute') return;
        var t = px(ps.top), l = px(ps.left), rr = px(ps.right), bb = px(ps.bottom);
        var w = px(ps.width), h = px(ps.height);
        var left = l !== null ? r.left + l : (rr !== null && w !== null ? r.right - rr - w : null);
        var right = rr !== null ? r.right - rr : (left !== null && w !== null ? left + w : null);
        var top = t !== null ? r.top + t : (bb !== null && h !== null ? r.bottom - bb - h : null);
        var bottom = bb !== null ? r.bottom - bb : (top !== null && h !== null ? top + h : null);
        if (left !== null && right !== null && top !== null && bottom !== null) grow({ left: left, top: top, right: right, bottom: bottom });
      });
    }
    return b;
  }

  function inText(el) {
    var cs = getComputedStyle(el);
    if (cs.display !== 'inline') return false;
    for (var p = el.parentElement; p; p = p.parentElement) {
      var d = getComputedStyle(p).display;
      if (d === 'inline') continue;
      var own = (el.textContent || '').trim().length;
      var whole = (p.textContent || '').replace(/\s+/g, ' ').trim().length;
      return whole > own + 1;
    }
    return false;
  }

  // ---- targets ----
  var small = [];
  var pressed = [];
  pressables.forEach(function (el) {
    if (!visible(el)) return;
    pressed.push(el);
    if (inText(el)) return;
    var b = box(el);
    var w = b.right - b.left, h = b.bottom - b.top;
    if (w + 0.5 >= MIN && h + 0.5 >= MIN) return;
    small.push({ what: describe(el), width: Math.round(w), height: Math.round(h) });
  });

  // ---- dock ----
  var probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;height:var(--dock-h, ' + options.dockFallback + 'px)';
  document.body.appendChild(probe);
  var dockH = probe.getBoundingClientRect().height || options.dockFallback;
  probe.remove();
  var dockTop = vh - dockH;

  // The shell's own dock when the surface draws the shell (a fixed nav the
  // dock's height along the bottom edge), or one laid where it would be, at
  // its z-index, so whatever would cover it or be covered by it does so here.
  var realDock = Array.prototype.find.call(document.querySelectorAll('nav'), function (n) {
    var r = n.getBoundingClientRect();
    return getComputedStyle(n).position === 'fixed' && r.bottom >= vh - 1 && Math.abs(r.height - dockH) <= 2 && r.width >= vw - 1;
  });
  var dockEl = realDock;
  if (!dockEl) {
    dockEl = document.createElement('div');
    dockEl.setAttribute('data-phone-check-dock', '');
    dockEl.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:' + dockH + 'px;z-index:var(--z-chrome, 40);background:transparent';
    document.body.appendChild(dockEl);
  }

  function held(el) {
    for (var a = el; a && a.nodeType === 1; a = a.parentElement) {
      var p = getComputedStyle(a).position;
      if (p === 'fixed' || p === 'sticky') return true;
    }
    return false;
  }
  var heldEls = pressed.filter(function (el) { return !dockEl.contains(el) && held(el); });
  var under = {};
  function look(where) {
    heldEls.forEach(function (el) {
      var r = el.getBoundingClientRect();
      var top = Math.max(r.top, dockTop), bottom = Math.min(r.bottom, vh);
      var left = Math.max(r.left, 0), right = Math.min(r.right, vw);
      if (bottom - top < 1 || right - left < 1) return;
      // Covered where the dock is the topmost thing at a point the element spans.
      var y = (top + bottom) / 2;
      var covered = [0.2, 0.5, 0.8].some(function (f) {
        var hit = document.elementFromPoint(left + (right - left) * f, y);
        return hit && dockEl.contains(hit);
      });
      if (!covered) return;
      var key = describe(el);
      if (!under[key]) under[key] = { what: key, top: Math.round(r.top), bottom: Math.round(r.bottom), where: where };
    });
  }
  var startY = window.scrollY;
  window.scrollTo(0, 0);
  look('top');
  window.scrollTo(0, doc.scrollHeight);
  look('bottom');
  window.scrollTo(0, startY);
  if (!realDock) dockEl.remove();
  var dock = { height: Math.round(dockH), under: Object.keys(under).map(function (k) { return under[k]; }) };

  // ---- contrast ----
  var canvas = document.createElement('canvas');
  canvas.width = 1; canvas.height = 1;
  var ctx = canvas.getContext('2d', { willReadFrequently: true });
  var cache = {};
  function rgba(css) {
    if (cache[css]) return cache[css];
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    var d = ctx.getImageData(0, 0, 1, 1).data;
    var out = [d[0], d[1], d[2], d[3] / 255];
    cache[css] = out;
    return out;
  }
  function compose(top, under, alpha) {
    var a = top[3] * (alpha === undefined ? 1 : alpha);
    return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
  }
  function lum(c) {
    var v = [c[0], c[1], c[2]].map(function (x) {
      x = x / 255;
      return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  function ratio(a, b) {
    var x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  var COLOUR = /(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\([^()]*\)|#[0-9a-f]{3,8}\b|\btransparent\b/gi;

  // The grounds an element's text is painted over, from the nearest opaque
  // one up: a list of possible colours, since a gradient is several.
  function grounds(el) {
    var layers = [];
    var opacity = 1;
    var image = false;
    for (var a = el; a && a.nodeType === 1; a = a.parentElement) {
      var cs = getComputedStyle(a);
      var bg = rgba(cs.backgroundColor);
      var img = cs.backgroundImage;
      if (img && img !== 'none') {
        if (img.indexOf('url(') !== -1) { image = true; break; }
        var stops = (img.match(COLOUR) || []).map(rgba);
        if (stops.length) layers.push({ stops: stops });
      }
      if (bg[3] > 0) layers.push({ stops: [bg] });
      if (layers.length === 0) opacity *= Number(cs.opacity);
      if (bg[3] >= 1) break;
    }
    var ground = [[255, 255, 255, 1]];
    for (var i = layers.length - 1; i >= 0; i--) {
      var next = [];
      ground.forEach(function (g) {
        layers[i].stops.forEach(function (s) { next.push(compose(s, g)); });
      });
      ground = next.slice(0, 32);
    }
    return { colours: ground, opacity: opacity, image: image };
  }

  // Ink check:contrast holds at 3:1 as decoration (--c-ink-ghost and its page
  // twin): text drawn in exactly that colour is held to the same floor here.
  function decoration(el, colour) {
    var cs = getComputedStyle(el);
    return options.decorationInks.some(function (token) {
      var value = cs.getPropertyValue(token).trim();
      if (!value) return false;
      var c = rgba(value);
      return Math.abs(c[0] - colour[0]) <= 1 && Math.abs(c[1] - colour[1]) <= 1 && Math.abs(c[2] - colour[2]) <= 1 && Math.abs(c[3] - colour[3]) <= 0.01;
    });
  }

  var faint = [];
  var unmeasured = 0;
  var seen = new Set();
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (var node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue || !node.nodeValue.trim()) continue;
    var host = node.parentElement;
    if (!host || seen.has(host)) continue;
    seen.add(host);
    var tag = host.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') continue;
    if (host.closest('[disabled], [aria-disabled=true]')) continue;
    if (!visible(host)) continue;
    var cs = getComputedStyle(host);
    var colour = rgba(cs.color);
    if (colour[3] === 0) continue;
    var g = grounds(host);
    if (g.image) { unmeasured++; continue; }
    var size = parseFloat(cs.fontSize);
    var bold = Number(cs.fontWeight) >= 700;
    var large = size >= 24 || (bold && size >= 18.66);
    var floor = large || decoration(host, colour) ? options.largeText : options.text;
    var worst = Infinity, worstGround = null;
    g.colours.forEach(function (ground) {
      var ink = compose(colour, ground, g.opacity);
      var r = ratio(ink, ground);
      if (r < worst) { worst = r; worstGround = ground; }
    });
    if (worst + 1e-6 < floor) {
      var hex = function (c) { return '#' + c.slice(0, 3).map(function (x) { return Math.round(x).toString(16).padStart(2, '0'); }).join(''); };
      var text = node.nodeValue.replace(/\s+/g, ' ').trim();
      faint.push({
        what: host.tagName.toLowerCase() + ' "' + (text.length > 40 ? text.slice(0, 39) + '…' : text) + '"',
        ratio: Math.round(worst * 100) / 100,
        floor: floor,
        ink: hex(compose(colour, worstGround, g.opacity)),
        ground: hex(worstGround),
      });
    }
  }

  return {
    sideways: sideways,
    targets: { minimum: MIN, small: small },
    dock: dock,
    contrast: { faint: faint, unmeasured: unmeasured },
  };
})`;
