/*
 * Small "how it works" animations for the landing page.
 *
 * The page's HTML already shows each picture in its finished state, so with
 * JavaScript off, or "reduce motion" turned on, nothing moves and nothing is
 * missing. Each step plays when it scrolls into view and repeats slowly while
 * it stays there; the hero plays once.
 */
(function () {
  if (!('IntersectionObserver' in window)) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  /** Run [delay, fn] pairs one after another; returns a cancel function. */
  function timeline(steps, done) {
    var timers = [];
    var at = 0;
    steps.forEach(function (step) {
      at += step[0];
      timers.push(setTimeout(step[1], at));
    });
    if (done) timers.push(setTimeout(done, at));
    return function () {
      timers.forEach(clearTimeout);
    };
  }

  function press(el) {
    el.classList.add('press');
    setTimeout(function () {
      el.classList.remove('press');
    }, 180);
  }

  // Each animation: reset() puts it at the start, steps() is what plays,
  // finish() restores the finished picture (used when it scrolls away).
  function show(el, on) {
    if (on) el.removeAttribute('hidden');
    else el.setAttribute('hidden', '');
  }

  // Each animation copies what the extension really does. reset() puts it at
  // the start, steps() is what plays, finish() restores the finished picture.
  var ANIMATIONS = {
    // The "+" form in the chat panel: type, the category is picked, save.
    save: function (root) {
      var box = root.querySelector('[data-type]');
      var btn = root.querySelector('[data-btn]');
      var cat = root.querySelector('[data-cat]');
      var status = root.querySelector('[data-status]');
      var text = box.textContent.trim();
      var picked = cat.textContent;
      return {
        reset: function () {
          box.textContent = '';
          box.classList.add('typing');
          cat.textContent = 'Auto category';
          show(status, false);
        },
        steps: function () {
          var list = [];
          for (var i = 1; i <= text.length; i += 1) {
            list.push([34, (function (n) {
              return function () {
                box.textContent = text.slice(0, n);
              };
            })(i)]);
          }
          list.push([300, function () { cat.textContent = picked; }]);
          list.push([700, function () { box.classList.remove('typing'); press(btn); }]);
          list.push([220, function () { show(status, true); }]);
          list.push([2800, function () {}]);
          return list;
        },
        finish: function () {
          box.textContent = text;
          box.classList.remove('typing');
          cat.textContent = picked;
          show(status, false);
        },
      };
    },

    // Memory opens the panel, tick two, Add: they go in above the message.
    add: function (root) {
      var pill = root.querySelector('[data-pill]');
      var panel = root.querySelector('[data-panel]');
      var rows = root.querySelectorAll('[data-row]');
      var btn = root.querySelector('[data-btn]');
      var flash = root.querySelector('[data-flash]');
      var ctx = root.querySelector('[data-ctx]');
      var lines = root.querySelectorAll('.ctx-line');
      function label(n) {
        btn.textContent = n ? 'Add ' + n + ' to message' : 'Add to message';
        btn.classList.toggle('dim', !n);
      }
      return {
        reset: function () {
          ctx.classList.add('closed');
          lines.forEach(function (line) { line.classList.add('out'); });
          rows.forEach(function (row) { row.classList.remove('on'); });
          label(0);
          show(panel, false);
          show(flash, false);
        },
        steps: function () {
          return [
            [800, function () { press(pill); }],
            [200, function () { show(panel, true); }],
            [650, function () { rows[0].classList.add('on'); label(1); }],
            [450, function () { rows[1].classList.add('on'); label(2); }],
            [650, function () { press(btn); }],
            [220, function () { show(panel, false); ctx.classList.remove('closed'); show(flash, true); }],
            [200, function () { lines[0].classList.remove('out'); }],
            [200, function () { lines[1].classList.remove('out'); }],
            [2600, function () { show(flash, false); }],
            [600, function () {}],
          ];
        },
        finish: function () {
          show(panel, false);
          show(flash, false);
          ctx.classList.remove('closed');
          lines.forEach(function (line) { line.classList.remove('out'); });
        },
      };
    },

    // Switch sync on, it checks each chatbot and waits for your OK, then writes.
    sync: function (root) {
      var badges = Array.prototype.slice.call(root.querySelectorAll('[data-badge]'));
      var switches = root.querySelectorAll('[data-sw]');
      var ask = root.querySelector('[data-ask]');
      var approve = root.querySelector('[data-approve]');
      function badge(index, kind, text) {
        badges[index].className = 'badge badge-' + kind;
        badges[index].textContent = text;
      }
      return {
        reset: function () {
          badges.forEach(function (_, index) { badge(index, 'off', 'Off'); });
          switches.forEach(function (sw) { sw.classList.remove('on'); });
          show(ask, false);
        },
        steps: function () {
          var list = [];
          badges.forEach(function (_, index) {
            list.push([index ? 350 : 800, function () {
              switches[index].classList.add('on');
              badge(index, 'wait', 'Checking');
            }]);
          });
          badges.forEach(function (_, index) {
            list.push([index ? 250 : 700, function () { badge(index, 'warn', 'Waiting for your OK'); }]);
          });
          list.push([300, function () { show(ask, true); }]);
          list.push([1100, function () { press(approve); }]);
          list.push([250, function () { show(ask, false); }]);
          badges.forEach(function (_, index) {
            list.push([index ? 400 : 300, function () { badge(index, 'ok', 'In sync · just now'); }]);
          });
          list.push([3000, function () {}]);
          return list;
        },
        finish: function () {
          badges.forEach(function (_, index) { badge(index, 'ok', 'In sync · just now'); });
          switches.forEach(function (sw) { sw.classList.add('on'); });
          show(ask, false);
        },
      };
    },

    // The chat panel: suggested memories are ticked by you, and the preview
    // shows them going in above what you typed.
    hero: function (root) {
      var items = Array.prototype.slice.call(root.querySelectorAll('.tray-item[data-line]'));
      var preview = root.querySelector('[data-preview]');
      var lines = root.querySelectorAll('.tp-line');
      var hint = root.querySelector('[data-hint]');
      var btn = root.querySelector('[data-btn]');
      function state(n) {
        items.forEach(function (item, index) { item.classList.toggle('on', index < n); });
        lines.forEach(function (line, index) { line.classList.toggle('out', index >= n); });
        preview.classList.toggle('closed', n === 0);
        hint.textContent = n ? '' : 'Tick memories to add them';
        btn.textContent = n ? 'Add ' + n + ' to message' : 'Add to message';
        btn.classList.toggle('dim', !n);
      }
      return {
        once: true,
        reset: function () { state(0); },
        steps: function () {
          return [
            [800, function () { state(1); }],
            [550, function () { state(2); }],
            [600, function () { press(btn); }],
          ];
        },
        finish: function () { state(items.length); },
      };
    },
  };

  document.querySelectorAll('[data-anim]').forEach(function (root) {
    var make = ANIMATIONS[root.getAttribute('data-anim')];
    if (!make) return;
    var anim = make(root);
    var cancel = null;
    var played = false;

    function play() {
      anim.reset();
      cancel = timeline(anim.steps(), function () {
        played = true;
        if (anim.once) return;
        play(); // loops while it stays on screen
      });
    }
    function stop() {
      if (cancel) cancel();
      cancel = null;
      anim.finish();
    }

    new IntersectionObserver(
      function (entries) {
        var visible = entries[0].isIntersecting;
        if (visible && !cancel && !(anim.once && played)) play();
        else if (!visible && cancel) stop();
      },
      { threshold: 0.6 },
    ).observe(root);
  });
})();
