/**
 * Shared Body Diagram Utility  (Session 23)
 *
 * Extracted from augmentsTab.js. Renders the inline SVG human body silhouette
 * used by both the Augments Tab and the Cultivation Tab.
 *
 * augmentsTab.js keeps its own inline copy for now — consolidation is tracked
 * as "Augments Tab body diagram overhaul" on the backlog.
 */

/**
 * Render the body silhouette SVG.
 *
 * @param {object}   [opts]
 * @param {object}   [opts.zoneClasses]   — map of zone id → extra CSS class string(s)
 *                                          e.g. { head: 'zone-active zone-selected' }
 * @param {string[]} [opts.overlayGroups] — SVG <g> HTML strings injected on top of the
 *                                          silhouette inside the same coordinate system.
 *                                          Used for meridian paths, the spirit root hex
 *                                          ring, core dot markers, etc.
 * @param {string}   [opts.extraClass]    — additional CSS class added to the <svg> root
 * @returns {string} SVG HTML string
 */
export function renderBodySVG({ zoneClasses = {}, overlayGroups = [], extraClass = '' } = {}) {
    function zc(zone) {
        const extra = zoneClasses[zone] ? ' ' + zoneClasses[zone] : '';
        return `aug-svg-zone${extra}`;
    }

    return `
        <svg class="aug-body-svg cult-body-svg${extraClass ? ' ' + extraClass : ''}"
             viewBox="0 0 160 380"
             xmlns="http://www.w3.org/2000/svg"
             overflow="visible">

            <!-- Body silhouette -->
            <g class="aug-silhouette">
                <!-- Head -->
                <ellipse cx="80" cy="38" rx="22" ry="26" />
                <!-- Neck -->
                <rect x="72" y="62" width="16" height="14" rx="4" />
                <!-- Torso -->
                <rect x="48" y="75" width="64" height="90" rx="8" />
                <!-- Left arm upper -->
                <rect x="22" y="78" width="22" height="55" rx="7" />
                <!-- Left arm lower -->
                <rect x="24" y="135" width="18" height="50" rx="6" />
                <!-- Left hand -->
                <ellipse cx="33" cy="193" rx="10" ry="8" />
                <!-- Right arm upper -->
                <rect x="116" y="78" width="22" height="55" rx="7" />
                <!-- Right arm lower -->
                <rect x="118" y="135" width="18" height="50" rx="6" />
                <!-- Right hand -->
                <ellipse cx="127" cy="193" rx="10" ry="8" />
                <!-- Pelvis -->
                <rect x="50" y="163" width="60" height="28" rx="6" />
                <!-- Left leg upper -->
                <rect x="50" y="190" width="26" height="70" rx="7" />
                <!-- Left leg lower -->
                <rect x="52" y="260" width="22" height="65" rx="6" />
                <!-- Left foot -->
                <ellipse cx="63" cy="332" rx="15" ry="8" />
                <!-- Right leg upper -->
                <rect x="84" y="190" width="26" height="70" rx="7" />
                <!-- Right leg lower -->
                <rect x="86" y="260" width="22" height="65" rx="6" />
                <!-- Right foot -->
                <ellipse cx="97" cy="332" rx="15" ry="8" />
            </g>

            <!-- Clickable zone overlays -->
            <ellipse class="${zc('head')}"     data-zone="head"
                     cx="80" cy="38" rx="26" ry="30" />
            <rect    class="${zc('armLeft')}"  data-zone="armLeft"
                     x="18" y="74" width="30" height="128" rx="8" />
            <rect    class="${zc('armRight')}" data-zone="armRight"
                     x="112" y="74" width="30" height="128" rx="8" />
            <rect    class="${zc('torso')}"    data-zone="torso"
                     x="44" y="72" width="72" height="122" rx="10" />
            <rect    class="${zc('legLeft')}"  data-zone="legLeft"
                     x="46" y="186" width="34" height="154" rx="8" />
            <rect    class="${zc('legRight')}" data-zone="legRight"
                     x="80" y="186" width="34" height="154" rx="8" />
            <g       class="${zc('misc')}"     data-zone="misc">
                <circle cx="80" cy="350" r="12" />
            </g>

            <!-- Injected overlay groups (hex ring, meridian paths, etc.) -->
            ${overlayGroups.join('\n')}

        </svg>
    `;
}
