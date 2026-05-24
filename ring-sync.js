(function () {
    var CIRC      = 395;  /* 2 * PI * 63 */
    var MIN_ARC   = 20;   /* minimum visible arc in px — ring never fully disappears */
    var ACCENT    = '#4f8ef7';
    var WARN      = '#ff9f0a';
    var DANGER    = '#ff4d6a';

    function syncRing() {
        var fill = document.getElementById('prog-fill');
        var arc  = document.getElementById('ring-arc');
        if (!fill || !arc) return;

        var pct    = Math.min(parseFloat(fill.style.width || '0') / 100, 1);
        var arcLen = pct * CIRC;

        // Enforce minimum visible arc so ring is never just a blank circle
        if (arcLen < MIN_ARC && arcLen > 0) arcLen = MIN_ARC;

        arc.style.strokeDashoffset = CIRC - arcLen;

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