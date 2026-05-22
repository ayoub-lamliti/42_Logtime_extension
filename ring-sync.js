(function () {
    var CIRC   = 452;
    var ACCENT = '#7a61ff';
    var WARN   = '#ff9f0a';
    var DANGER = '#ff453a';

    function syncRing() {
        var fill = document.getElementById('prog-fill');
        var arc  = document.getElementById('ring-arc');
        if (!fill || !arc) return;
        var pct = Math.min(parseFloat(fill.style.width || '0') / 100, 1);
        arc.style.strokeDashoffset = CIRC * (1 - pct);
        if (fill.classList.contains('danger')) {
            arc.style.stroke = DANGER;
        } else if (fill.classList.contains('warn')) {
            arc.style.stroke = WARN;
        } else {
            arc.style.stroke = ACCENT;
        }
    }

    var obs = new MutationObserver(syncRing);

    function init() {
        var fill = document.getElementById('prog-fill');
        if (fill) {
            obs.observe(fill, { attributes: true, attributeFilter: ['style', 'class'] });
            syncRing();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    window.addEventListener('load', syncRing);
})();
