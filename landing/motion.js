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
  var ANIMATIONS = {
    save: function (root) {
      var box = root.querySelector('[data-type]');
      var btn = root.querySelector('[data-btn]');
      var text = box.textContent.trim();
      return {
        reset: function () {
          box.textContent = '';
          box.classList.add('typing');
          btn.textContent = 'Save memory';
          btn.classList.remove('done');
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
          list.push([450, function () { box.classList.remove('typing'); press(btn); }]);
          list.push([200, function () { btn.textContent = 'Saved ✓'; btn.classList.add('done'); }]);
          list.push([2800, function () {}]);
          return list;
        },
        finish: function () {
          box.textContent = text;
          box.classList.remove('typing');
          btn.textContent = 'Save memory';
          btn.classList.remove('done');
        },
      };
    },

    add: function (root) {
      var pill = root.querySelector('[data-pill]');
      var ctx = root.querySelector('[data-ctx]');
      var lines = root.querySelectorAll('.ctx-line');
      return {
        reset: function () {
          ctx.classList.add('closed');
          lines.forEach(function (line) { line.classList.add('out'); });
        },
        steps: function () {
          return [
            [900, function () { press(pill); }],
            [250, function () { ctx.classList.remove('closed'); }],
            [250, function () { lines[0].classList.remove('out'); }],
            [300, function () { lines[1].classList.remove('out'); }],
            [3200, function () {}],
          ];
        },
        finish: function () {
          ctx.classList.remove('closed');
          lines.forEach(function (line) { line.classList.remove('out'); });
        },
      };
    },

    sync: function (root) {
      var badges = Array.prototype.slice.call(root.querySelectorAll('.badge'));
      var finals = badges.map(function (badge) {
        return { className: badge.className, text: badge.textContent };
      });
      function settle(index) {
        badges[index].className = finals[index].className;
        badges[index].textContent = finals[index].text;
      }
      return {
        reset: function () {
          badges.forEach(function (badge) {
            badge.className = 'badge badge-wait';
            badge.textContent = 'Syncing';
          });
        },
        steps: function () {
          return [
            [1000, function () { settle(0); }],
            [600, function () { settle(1); }],
            [600, function () { settle(2); }],
            [3400, function () {}],
          ];
        },
        finish: function () {
          badges.forEach(function (_, index) { settle(index); });
        },
      };
    },

    hero: function (root) {
      var items = Array.prototype.slice.call(root.querySelectorAll('.tray-item.on'));
      var count = root.querySelector('[data-count]');
      var btn = root.querySelector('[data-btn]');
      function show(n) {
        count.textContent = n + ' selected';
        btn.textContent = n ? 'Add ' + n + ' to message' : 'Add to message';
      }
      return {
        once: true,
        reset: function () {
          items.forEach(function (item) { item.classList.remove('on'); });
          show(0);
        },
        steps: function () {
          return [
            [700, function () { items[0].classList.add('on'); show(1); }],
            [450, function () { items[1].classList.add('on'); show(2); }],
            [500, function () { press(btn); }],
          ];
        },
        finish: function () {
          items.forEach(function (item) { item.classList.add('on'); });
          show(items.length);
        },
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
