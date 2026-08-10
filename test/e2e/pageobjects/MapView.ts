import { VSBrowser, WebView } from 'vscode-extension-tester';
import { SimulationsView } from './SimulationsView.ts';
import { enterWebview, leaveWebview, waitForSelector } from './webview.ts';

/**
 * Page object for the Triforge `MapEditor` WebviewPanel (`triforgeMap`).
 *
 * The MapEditor is an EDITOR-AREA webview panel (not a sidebar view), rendered
 * by `src/panels/MapEditor.ts` from `src/panels/templates/MapEditorHtml.ts` and
 * driven client-side by `src/webview-ui/map/MapController.ts` (+ `ui/UIManager.ts`).
 * It is NOT openable from the palette: `triforge.openMap` requires a project arg
 * and there is no menu/palette entry that supplies one. The real, project-aware
 * affordance that reveals it is the "Animate" context action
 * (`triforge.loadAnimation`) on an output node — `revealAndUnfold(activeProject)`
 * -> `ensureDemVisible()` -> `loadDemIfAvailable()` then streams animation
 * frames. This PO opens the map through that affordance and attaches to the
 * panel's webview via the shared {@link enterWebview} helper, so iframe handling
 * lives in exactly one place.
 *
 * All DOM accessors must be called while focused INSIDE the webview iframe
 * ({@link enterWebview} -> ... -> {@link leaveWebview}). The PO keeps the
 * entered {@link WebView} and runs queries on the shared driver via
 * {@link waitForSelector} / `executeScript`.
 */
export class MapView {
  private webview: WebView | undefined;
  private readonly sims = new SimulationsView();

  /** The webview, after {@link openViaAnimate}/{@link attach} has entered it. */
  private get wv(): WebView {
    if (!this.webview) {
      throw new Error('MapView is not attached — call openViaAnimate()/attach() first');
    }
    return this.webview;
  }

  /**
   * Open the map through the REAL "Animate" context action on the seeded output
   * category (`Output` > `category`, default `Ascii`), which reveals the
   * MapEditor for the active project, loads its DEM, then streams animation
   * frames. After the action fires, {@link attach} into the panel's webview.
   *
   * `triforge.loadAnimation` shows a cancellable "Loading N Frames" progress while
   * frames stream in; the webview is mounted immediately on reveal, so we can
   * attach and assert DEM/animation state as it settles.
   */
  async openViaAnimate(category: string = 'Ascii'): Promise<void> {
    await this.sims.selectContextMenuAction('Animate', 'Output', category);
    await this.attach();
  }

  /**
   * Re-reveal the ALREADY-OPEN MapEditor panel a second time WITHOUT disposing
   * it, by firing the same "Animate" context action again. Because the panel was
   * only {@link detach}ed (the driver frame switched back to the workbench, the
   * panel itself never closed) and `retainContextWhenHidden: true` keeps its JS
   * context alive, the second `triforge.loadAnimation` hits `createOrShow`'s
   * EXISTING-panel branch (`MapEditor.ts:87–93`) -> `loadDemIfAvailable()` on the
   * SAME instance, so the `_currentDemData` cache and any counter we installed on
   * the retained webview survive across this reveal. This is the precondition for
   * MAP-2/PERF-1: the cache-hit branch is only reachable on a retained instance.
   *
   * Crucially this does NOT call `closeAllEditors()` (which would dispose the
   * panel via `onDidDispose` and reset the per-instance cache + lose the counter).
   */
  async revealSamePanelViaAnimate(category: string = 'Ascii'): Promise<void> {
    await this.sims.selectContextMenuAction('Animate', 'Output', category);
    await this.attach();
  }

  /**
   * Attach to the already-revealed MapEditor webview: switch the driver into its
   * (nested) iframe and wait for the Leaflet `#map` container to mount.
   */
  async attach(timeoutMs: number = 30000): Promise<void> {
    this.webview = await enterWebview(timeoutMs);
    await waitForSelector(this.wv, '#map', timeoutMs);
  }

  /** Leave the webview iframe, returning the driver to the workbench frame. */
  async detach(): Promise<void> {
    if (this.webview) {
      await leaveWebview(this.webview).catch(() => undefined);
      this.webview = undefined;
    }
  }

  /** Run a script inside the entered webview document. */
  private exec<T>(script: string, ...args: unknown[]): Promise<T> {
    return VSBrowser.instance.driver.executeScript(script, ...args) as Promise<T>;
  }

  // --- DEM (MAP-1) -----------------------------------------------------------

  /**
   * Whether the DEM control pane (`#pane-dem`) is visible. The pane starts
   * `display:none` and is shown (`block`) by `handleActivateLayer('dem')` /
   * `setDemPaneVisibility(true)` once the DEM renders.
   */
  isDemPaneVisible(): Promise<boolean> {
    return this.exec<boolean>(
      `const p = document.getElementById('pane-dem');
       return !!p && getComputedStyle(p).display !== 'none';`,
    );
  }

  /** Whether `#dem-checkbox` exists and is currently checked. */
  isDemChecked(): Promise<boolean> {
    return this.exec<boolean>(
      `const cb = document.getElementById('dem-checkbox');
       return !!cb && cb.checked === true;`,
    );
  }

  /** `#dem-legend-canvas`'s pixel width (>0 once the canvas is mounted/drawn). */
  demLegendCanvasWidth(): Promise<number> {
    return this.exec<number>(
      `const c = document.getElementById('dem-legend-canvas');
       return c ? c.width : -1;`,
    );
  }

  /**
   * Whether the DEM legend canvas has any non-transparent pixels — i.e.
   * `LegendRenderer.draw('dem-legend-canvas', ...)` actually painted a gradient
   * (the colormap legend) rather than leaving a blank canvas.
   */
  demLegendCanvasDrawn(): Promise<boolean> {
    return this.exec<boolean>(
      `const c = document.getElementById('dem-legend-canvas');
       if (!c || !c.getContext) return false;
       const ctx = c.getContext('2d');
       const d = ctx.getImageData(0, 0, c.width, c.height).data;
       for (let i = 3; i < d.length; i += 4) { if (d[i] !== 0) return true; }
       return false;`,
    );
  }

  /**
   * The DEM legend range as reflected by the `#dem-min-input` / `#dem-max-input`
   * fields. They read `"Auto"` until a DEM renders, at which point
   * `MapController.updateInputIfAuto` writes `value.toFixed(2)` of the loaded
   * data min/max (a real range).
   */
  async demLegendRange(): Promise<{ min: string; max: string }> {
    return this.exec<{ min: string; max: string }>(
      `const min = document.getElementById('dem-min-input');
       const max = document.getElementById('dem-max-input');
       return { min: min ? min.value : '', max: max ? max.value : '' };`,
    );
  }

  /** Toggle `#dem-checkbox` and fire its change handler (round-trips DEM layer visibility). */
  async toggleDem(): Promise<void> {
    await this.exec(
      `const cb = document.getElementById('dem-checkbox');
       if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change', { bubbles: true })); }`,
    );
  }

  /**
   * Whether the DEM overlay canvas is currently visible. `DemLayer.toggle`
   * flips THAT canvas's `display`, so this reflects the round-tripped DEM
   * visibility after {@link toggleDem}. Targets the DEM layer's own canvas via
   * `window.mapController.demLayer.getCanvas()` so it is not confused by other
   * overlay canvases (streamflow / animation) sharing the overlay pane.
   */
  isDemOverlayVisible(): Promise<boolean> {
    return this.exec<boolean>(
      `const ctrl = window.mapController;
       if (!ctrl || !ctrl.demLayer || !ctrl.demLayer.getCanvas) return false;
       const c = ctrl.demLayer.getCanvas();
       if (!c) return false;
       return getComputedStyle(c).display !== 'none';`,
    );
  }

  // --- DEM re-parse signal (MAP-2 / PERF-1) ----------------------------------

  /**
   * Install a counter on the (retained) webview that increments
   * `window.__demRenderCount` every time the host posts a `renderDem` message —
   * i.e. every time `MapEditor.loadDemIfAvailable` ACTUALLY parses the DEM and
   * ships the grid (the cache-hit path posts nothing). Idempotent: re-installing
   * does not double-count. Call AFTER the first reveal has settled, then reveal
   * the same panel again and read {@link demRenderCount}.
   */
  async installDemRenderCounter(): Promise<void> {
    await this.exec(
      `if (!window.__demRenderCounterInstalled) {
         window.__demRenderCount = 0;
         window.addEventListener('message', (e) => {
           if (e && e.data && e.data.command === 'renderDem') {
             window.__demRenderCount = (window.__demRenderCount || 0) + 1;
           }
         });
         window.__demRenderCounterInstalled = true;
       }`,
    );
  }

  /** Read the `renderDem`-message count installed by {@link installDemRenderCounter}. */
  demRenderCount(): Promise<number> {
    return this.exec<number>(
      `return (typeof window.__demRenderCount === 'number') ? window.__demRenderCount : -1;`,
    );
  }

  // --- Non-DEM layers + base-layer switching (MAP-5) -------------------------

  /** Whether a named control pane (`#pane-<id>`) is visible. */
  isPaneVisible(paneId: string): Promise<boolean> {
    return this.exec<boolean>(
      `const p = document.getElementById(arguments[0]);
       return !!p && getComputedStyle(p).display !== 'none';`,
      paneId,
    );
  }

  /** Toggle a layer checkbox by element id and fire its change handler. */
  async toggleCheckbox(checkboxId: string): Promise<boolean> {
    return this.exec<boolean>(
      `const cb = document.getElementById(arguments[0]);
       if (!cb) return false;
       cb.checked = !cb.checked;
       cb.dispatchEvent(new Event('change', { bubbles: true }));
       return cb.checked;`,
      checkboxId,
    );
  }

  /** Whether a layer checkbox is currently checked. */
  isCheckboxChecked(checkboxId: string): Promise<boolean> {
    return this.exec<boolean>(
      `const cb = document.getElementById(arguments[0]);
       return !!cb && cb.checked === true;`,
      checkboxId,
    );
  }

  /**
   * The `data-layer` of the currently-active base-layer option in the layer
   * switcher (the `.layer-option.active` entry). `OpenStreetMap` is active by
   * default (it carries the `active` class in the template).
   */
  activeBaseLayer(): Promise<string> {
    return this.exec<string>(
      `const a = document.querySelector('#layer-menu .layer-option.active');
       return a ? (a.dataset.layer || '') : '';`,
    );
  }

  /**
   * Open the base-layer switcher menu and click the `.layer-option` whose
   * `data-layer` equals `name` (e.g. `None`, `OpenTopoMap`). Fires the option's
   * real click handler (`UIManager` -> `setBaseLayer` + active-class swap).
   */
  async pickBaseLayer(name: string): Promise<void> {
    await this.exec(
      `const toggle = document.getElementById('layer-toggle-btn');
       if (toggle) toggle.click();
       const opt = document.querySelector('#layer-menu .layer-option[data-layer="' + arguments[0] + '"]');
       if (!opt) throw new Error('no base-layer option ' + arguments[0]);
       opt.click();`,
      name,
    );
  }

  /** Whether a Leaflet base tile layer is currently present on the map (false after picking `None`). */
  hasBaseTileLayer(): Promise<boolean> {
    return this.exec<boolean>(
      `const c = document.querySelector('.leaflet-tile-pane');
       if (!c) return false;
       return c.querySelectorAll('.leaflet-tile-container').length > 0
         || c.querySelectorAll('img.leaflet-tile').length > 0
         || c.children.length > 0;`,
    );
  }

  // --- Interactive chrome (MAP-6) --------------------------------------------

  /** Whether the named floating control pane carries the `draggable="true"` attribute. */
  isPaneDraggable(paneId: string): Promise<boolean> {
    return this.exec<boolean>(
      `const p = document.getElementById(arguments[0]);
       return !!p && p.getAttribute('draggable') === 'true';`,
      paneId,
    );
  }

  /**
   * Select a DEM colormap by value in `#color-map-select` and fire `change`,
   * which re-draws `#dem-legend-canvas` via `LegendRenderer.draw`. Returns the
   * canvas pixel signature (a cheap hash of the legend pixels) so a caller can
   * assert the legend actually changed.
   */
  async selectDemColormap(value: string): Promise<string> {
    return this.exec<string>(
      `const sel = document.getElementById('color-map-select');
       if (!sel) throw new Error('no #color-map-select');
       sel.value = arguments[0];
       sel.dispatchEvent(new Event('change', { bubbles: true }));
       const c = document.getElementById('dem-legend-canvas');
       const ctx = c.getContext('2d');
       const d = ctx.getImageData(0, 0, c.width, c.height).data;
       let h = 0;
       for (let i = 0; i < d.length; i += 17) { h = (h * 31 + d[i]) >>> 0; }
       return String(h);`,
      value,
    );
  }

  /** Whether the layer-switcher menu is open (visible). */
  isLayerMenuOpen(): Promise<boolean> {
    return this.exec<boolean>(
      `const m = document.getElementById('layer-menu');
       if (!m) return false;
       const cs = getComputedStyle(m);
       return cs.display !== 'none' && cs.visibility !== 'hidden';`,
    );
  }

  // --- Animation (MAP-2 / MAP-3 deps) ----------------------------------------

  /** Whether the animation pane (`#pane-animation`) is visible. */
  isAnimationPaneVisible(): Promise<boolean> {
    return this.isPaneVisible('pane-animation');
  }

  /**
   * Parse `#anim-frame-label` ("N / M" once frames load, "Loading: i / total"
   * while streaming). Returns `{ current, total }` (NaN where unparseable).
   */
  async frameLabel(): Promise<{ current: number; total: number; raw: string }> {
    const raw = await this.exec<string>(
      `const l = document.getElementById('anim-frame-label');
       return l ? (l.innerText || l.textContent || '') : '';`,
    );
    const m = raw.match(/(\d+)\s*\/\s*(\d+)/);
    return {
      raw,
      current: m ? parseInt(m[1], 10) : NaN,
      total: m ? parseInt(m[2], 10) : NaN,
    };
  }

  /**
   * The total frame count — read from the controller's `animationFrames.length`
   * (authoritative, post-stitch). `index.ts` exposes the controller on
   * `window.mapController`.
   */
  frameCount(): Promise<number> {
    return this.exec<number>(
      `return (window.mapController && window.mapController.animationFrames)
         ? window.mapController.animationFrames.length
         : -1;`,
    );
  }

  /**
   * Wait until the animation has finished loading: the frame label settles to
   * the final "N / M" form (not "Loading: ...") with M > 0. Returns the total.
   */
  async waitForAnimationLoaded(timeoutMs: number = 120000): Promise<number> {
    const driver = VSBrowser.instance.driver;
    let total = NaN;
    await driver.wait(
      async () => {
        const { raw, total: t } = await this.frameLabel();
        if (/^\s*\d+\s*\/\s*\d+\s*$/.test(raw) && t > 0) {
          total = t;
          return true;
        }
        return false;
      },
      timeoutMs,
      'animation frames never finished loading (#anim-frame-label never settled to "N / M")',
    );
    return total;
  }

  /** Click the play/pause button (`#animation-play-btn`). */
  async playPause(): Promise<void> {
    await this.exec(
      `const b = document.getElementById('animation-play-btn');
       if (b) b.click();`,
    );
  }

  // --- Animation play / step / GIF export (ANI-1 / ANI-3) --------------------

  /**
   * The controller's authoritative play state (`window.mapController.isPlaying`),
   * which `togglePlay()` flips when `#animation-play-btn` is clicked. Returns
   * `false` if the controller is not present.
   */
  isPlaying(): Promise<boolean> {
    return this.exec<boolean>(
      `return !!(window.mapController && window.mapController.isPlaying);`,
    );
  }

  /**
   * The controller's current frame index (`window.mapController.currentFrameIndex`,
   * 0-based). The `#anim-frame-label` shows `currentFrameIndex + 1`. Returns -1 if
   * the controller is absent.
   */
  currentFrameIndex(): Promise<number> {
    return this.exec<number>(
      `return (window.mapController && typeof window.mapController.currentFrameIndex === 'number')
         ? window.mapController.currentFrameIndex
         : -1;`,
    );
  }

  /** The `max` attribute of `#animation-slider` (= frameCount-1 once loaded; -1 if absent). */
  sliderMax(): Promise<number> {
    return this.exec<number>(
      `const s = document.getElementById('animation-slider');
       return s ? parseInt(s.max, 10) : -1;`,
    );
  }

  /**
   * Step the animation to `index` by setting `#animation-slider`'s value and
   * firing its real `input` handler (`UIManager` -> `currentFrameIndex = index`
   * -> `renderAnimationFrame()` -> `#anim-frame-label` updates). This drives the
   * SAME path a user dragging the slider would.
   */
  async stepToFrame(index: number): Promise<void> {
    await this.exec(
      `const s = document.getElementById('animation-slider');
       if (!s) throw new Error('no #animation-slider');
       s.value = String(arguments[0]);
       s.dispatchEvent(new Event('input', { bubbles: true }));`,
      index,
    );
  }

  /** Whether `#save-gif` (the Download-GIF button) is currently visible (display !== none). */
  isSaveGifVisible(): Promise<boolean> {
    return this.exec<boolean>(
      `const b = document.getElementById('save-gif');
       return !!b && getComputedStyle(b).display !== 'none';`,
    );
  }

  /**
   * Install a probe that counts GIF-export initiations by wrapping the
   * controller's `handleFinishCrop` — the method a confirmed crop invokes, which
   * is the EXACT point that posts `triggerGifExport` to the HOST to begin the
   * export (`MapController.ts:703–729` -> `MapEditor._initGifExport`). Idempotent;
   * read with {@link gifExportTriggeredCount}.
   *
   * Two deliberate choices (both forced by real constraints):
   *  - We wrap `handleFinishCrop` (the source function on the export path) rather
   *    than `vscode.postMessage`, because the webview's acquired VS Code API
   *    object is FROZEN — its `postMessage` is non-writable/non-configurable
   *    (verified at runtime), so a `postMessage` wrap silently no-ops. The
   *    controller method is the faithful, drivable seam: it is invoked iff a crop
   *    is actually confirmed, which is exactly when the host export is triggered.
   *  - The probe COUNTS the initiation but does NOT call the original, so the
   *    host's `_initGifExport` -> `vscode.window.showSaveDialog` NATIVE OS dialog
   *    never opens. That native dialog cannot be Selenium-driven and, left open,
   *    wedges the VS Code UI thread (blocking teardown/retries). Stubbing the post
   *    is the strongest faithful observable UP TO the native-dialog boundary:
   *    "the crop-confirm reaches the export-initiation method", without crossing
   *    the un-driveable boundary. (We do NOT fabricate a written-file assertion.)
   */
  async installGifExportProbe(): Promise<void> {
    await this.exec(
      `const ctrl = window.mapController;
       if (ctrl && !window.__gifProbeInstalled && typeof ctrl.handleFinishCrop === 'function') {
         window.__gifExportCount = 0;
         ctrl.handleFinishCrop = function (rect) {
           window.__gifExportCount = (window.__gifExportCount || 0) + 1;
           // Intentionally do NOT invoke the original: the original posts
           // triggerGifExport to the host, which opens a native save dialog that
           // Selenium cannot drive and that wedges the session if left open. The
           // count proves the export was initiated at this last drivable seam.
           return undefined;
         };
         window.__gifProbeInstalled = true;
       }`,
    );
  }

  /** Read the export-initiation count installed by {@link installGifExportProbe} (-1 if not installed). */
  gifExportTriggeredCount(): Promise<number> {
    return this.exec<number>(
      `return (typeof window.__gifExportCount === 'number') ? window.__gifExportCount : -1;`,
    );
  }

  /**
   * Click `#save-gif`. With frames loaded, `UIManager`'s handler pauses any
   * playback, disables map interaction and calls `cropManager.start()` — entering
   * crop mode (the precursor to the GIF export). With NO frames loaded the handler
   * returns early (a no-op), which is itself an asserted observable.
   */
  async clickSaveGif(): Promise<void> {
    await this.exec(
      `const b = document.getElementById('save-gif');
       if (!b) throw new Error('no #save-gif');
       b.click();`,
    );
  }

  /**
   * Whether the GIF crop overlay (`#crop-box`, created + shown by
   * `CropManager.start()`) is currently visible. Crop mode is the on-screen state
   * that clicking `#save-gif` enters before the export's native save dialog.
   */
  isCropBoxVisible(): Promise<boolean> {
    return this.exec<boolean>(
      `const c = document.getElementById('crop-box');
       return !!c && getComputedStyle(c).display !== 'none';`,
    );
  }

  /**
   * Confirm the active crop by firing the Enter keydown `CropManager` listens for
   * (`CropManager.ts:108–118`) -> `onConfirm(rect)` -> `MapController.handleFinishCrop`
   * -> posts `triggerGifExport` to the host. This is the strongest faithful step
   * BEFORE the host's native `showSaveDialog` (which Selenium cannot drive).
   */
  async confirmCropWithEnter(): Promise<void> {
    await this.exec(
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`,
    );
  }

  // --- Tooltip (MAP-3) -------------------------------------------------------

  /**
   * Clear the loaded DEM in the webview (the `clearDem` message handler), as the
   * host's `clearDem()` would. Sets `currentDemData = null` and hides the DEM
   * pane — the precondition for the BUG-5 tooltip null-deref.
   */
  async clearDem(): Promise<void> {
    await this.exec(`window.postMessage({ command: 'clearDem' }, '*');`);
    await VSBrowser.instance.driver.sleep(300);
  }

  /**
   * Force the tooltip element (`#map-tooltip`) hidden and blank, the way
   * Leaflet's `mouseout` would. The BUG-5 null-deref throws INSIDE
   * `Tooltip.update` BEFORE it ever hides/repaints the element, so without this
   * reset a prior (pre-clear) hover would leave the tooltip showing STALE text +
   * `display:block` — a DOM read would then mistake that stale tooltip for a
   * "live" one and the post-clear assertion could pass for the wrong reason.
   * Resetting first means a post-clear "visible+text" reading can ONLY come from
   * a hover that actually re-showed it (i.e. the post-fix recovery), so the
   * xfail flips honestly.
   */
  async resetTooltip(): Promise<void> {
    await this.exec(
      `const tip = document.getElementById('map-tooltip');
       if (tip) { tip.style.display = 'none'; tip.innerText = ''; }`,
    );
  }

  /**
   * Move the mouse over the centre of `#map` and report whether the tooltip
   * (`#map-tooltip`) is showing AND carries text. Returns `{ visible, text }`.
   *
   * The controller's tooltip is driven by Leaflet's `this.map.on('mousemove')`
   * (`MapController.ts:425`), and `Tooltip.update` consumes `e.originalEvent` via
   * `this.map.mouseEventToLayerPoint(...)`. A bare synthetic `MouseEvent` on
   * `#map` is NOT a reliable trigger: Leaflet's DOM-event plumbing may not
   * forward it into the `mousemove` handler (or yields no layer point), which
   * would leave the tooltip hidden for a reason unrelated to BUG-5. So we drive
   * the controller's handler the way Leaflet itself would: build a real
   * `originalEvent` carrying the centre client coordinates, then call
   * `window.mapController.map.fire('mousemove', { originalEvent, ... })`. That
   * invokes the SAME registered handler, which calls
   * `mouseEventToLayerPoint(originalEvent)` -> `ProjectionManager.pixelToDem` on
   * the map centre (inside the fitted DEM/animation bounds) -> a real value.
   *
   * With an animation visible and the DEM cleared, BUG-5's anim branch
   * (`Tooltip.ts:113–118`) dereferences `demData.header.ncols` on a null
   * `currentDemData` and throws INSIDE this handler, so the tooltip stops
   * updating (stays hidden) for the session — which is exactly the post-clear
   * failure MAP-3 guards. The pre-clear baseline (see the suite) proves this same
   * call DOES show the tooltip while the DEM is loaded, so the post-clear failure
   * is attributable to the null-deref and the post-fix recovery is a real flip.
   */
  async hoverMapAndReadTooltip(): Promise<{ visible: boolean; text: string }> {
    return this.exec<{ visible: boolean; text: string }>(
      `const map = document.getElementById('map');
       const r = map.getBoundingClientRect();
       const cx = r.left + r.width / 2;
       const cy = r.top + r.height / 2;
       const originalEvent = {
         clientX: cx, clientY: cy, pageX: cx, pageY: cy,
         target: map, type: 'mousemove',
       };
       const ctrl = window.mapController;
       if (ctrl && ctrl.map && typeof ctrl.map.fire === 'function') {
         // Drive Leaflet's own mousemove handler with a real originalEvent so
         // Tooltip.update's mouseEventToLayerPoint(e.originalEvent) resolves a
         // layer point at the map centre. The handler only consumes
         // e.originalEvent, so latlng is not needed.
         try {
           ctrl.map.fire('mousemove', { originalEvent: originalEvent, type: 'mousemove' });
         } catch (e) {
           // If firing through Leaflet throws (e.g. BUG-5's null-deref inside the
           // handler), the tooltip stays hidden — surface that as not-shown, not
           // as a PO error.
         }
       } else {
         // Fallback: a bare DOM event (less reliable, but better than nothing).
         map.dispatchEvent(new MouseEvent('mousemove', {
           bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy,
         }));
       }
       const tip = document.getElementById('map-tooltip');
       if (!tip) return { visible: false, text: '' };
       const visible = getComputedStyle(tip).display !== 'none';
       return { visible, text: tip.innerText || tip.textContent || '' };`,
    );
  }

  // --- Document / CSP (MAP-7) ------------------------------------------------

  /** The webview document's full serialized HTML (`<html>` outerHTML). */
  documentHtml(): Promise<string> {
    return this.exec<string>(`return document.documentElement.outerHTML;`);
  }

  /**
   * Whether the loaded webview references unpkg.com in ANY load-bearing way:
   * a `<script src>`, a `<link href>`, or the CSP `<meta>` content. The SEC-4
   * fix bundles Leaflet locally and drops unpkg from all three, so post-fix this
   * returns false.
   */
  hasUnpkgReference(): Promise<boolean> {
    return this.exec<boolean>(
      `const scriptSrc = !!document.querySelector('script[src*="unpkg.com"]');
       const linkHref = !!document.querySelector('link[href*="unpkg.com"]');
       const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
       const cspHasUnpkg = !!(meta && (meta.getAttribute('content') || '').includes('unpkg.com'));
       return scriptSrc || linkHref || cspHasUnpkg;`,
    );
  }
}
