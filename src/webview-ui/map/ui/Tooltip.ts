import { ProjectionManager } from '../ProjectionManager';

export class Tooltip {
    private element: HTMLElement;
    private enabled: boolean = true;
    private map: any; // Leaflet map

    constructor(map: any) {
        this.map = map;
        this.element = document.createElement('div');
        this.element.id = 'map-tooltip';
        this.element.style.cssText = `
            position: absolute;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            pointer-events: none;
            display: none;
            z-index: 3000;
            white-space: nowrap;
        `;
        document.body.appendChild(this.element);

        this.map.on('mouseout', () => {
            this.element.style.display = 'none';
        });
    }

    public setEnabled(enabled: boolean) {
        this.enabled = enabled;
        if (!enabled) {
            this.element.style.display = 'none';
        }
    }

    public isEnabled() {
        return this.enabled;
    }

    public update(e: any, demData: any, initData: any, animationData: any, currentFrameIndex: number, animCanvas: HTMLElement | null, demCanvas: HTMLElement | null, initCanvas: HTMLElement | null, qxData: any = null, qxCanvas: HTMLElement | null = null, animGridWidth: number = 0) {
        if (!this.enabled || !ProjectionManager.invMatrix) {
            this.element.style.display = 'none';
            return;
        }

        const mapPane = this.map.getPane('overlayPane');

        // Visibility checks
        const demVisible = demData && demCanvas && demCanvas.style.display !== 'none' && mapPane.contains(demCanvas);
        const initVisible = initData && initCanvas && initCanvas.style.display !== 'none' && mapPane.contains(initCanvas);
        const animVisible = animationData && animationData.length > 0 && animCanvas && animCanvas.style.display !== 'none' && mapPane.contains(animCanvas);
        const qxVisible = qxData && qxCanvas && qxCanvas.style.display !== 'none' && mapPane.contains(qxCanvas);

        if (!demVisible && !initVisible && !animVisible && !qxVisible) {
            this.element.style.display = 'none';
            return;
        }

        // Determine Priority based on pane position (Leftmost = Top priority)
        const panes = [
            { id: 'pane-dem', type: 'dem', visible: demVisible },
            { id: 'pane-init', type: 'init', visible: initVisible },
            { id: 'pane-animation', type: 'anim', visible: animVisible },
            { id: 'pane-qxqy', type: 'qxqy', visible: qxVisible }
        ];

        const sortedPanes = panes
            .filter(p => p.visible)
            .map(p => {
                const el = document.getElementById(p.id);
                return { ...p, left: el ? el.getBoundingClientRect().left : 99999 };
            })
            .sort((a, b) => a.left - b.left); // Ascending left (smaller left = first)


        const layerPoint = this.map.mouseEventToLayerPoint(e.originalEvent);
        const srcPt = ProjectionManager.pixelToDem(layerPoint.x, layerPoint.y);

        if (!srcPt) {
            this.element.style.display = 'none';
            return;
        }

        let foundValue: { val: string, label: string } | null = null;

        for (const pane of sortedPanes) {
            const col = Math.floor(srcPt[0]);
            const row = Math.floor(srcPt[1]);

            if (pane.type === 'dem') {
                const numRows = demData.values.length;
                const numCols = demData.values[0].length;
                if (row >= 0 && row < numRows && col >= 0 && col < numCols) {
                    const val = demData.values[row][col];
                    if (val !== demData.header.NODATA_value) {
                        foundValue = { val: val.toFixed(2), label: 'DEM' };
                        break;
                    }
                }
            } else if (pane.type === 'init') {
                const numRows = initData.values.length;
                const numCols = initData.values[0].length;
                if (row >= 0 && row < numRows && col >= 0 && col < numCols) {
                    const val = initData.values[row][col];
                    const noData = initData.header ? initData.header.NODATA_value : -9999;
                    if (val !== noData) {
                        foundValue = { val: val.toFixed(2), label: 'Init' };
                        break;
                    }
                }
            } else if (pane.type === 'anim') {
                // BUG-5: do NOT dereference demData.header.ncols here — after the
                // DEM is cleared (handleClearDem) demData is null, which would
                // throw on the next mousemove and break the tooltip for the rest
                // of the session. Use the animation grid width supplied by
                // AnimationLayer.setDemContext, falling back to the DEM header's
                // ncols only when it is still present.
                const numCols = animGridWidth > 0
                    ? animGridWidth
                    : (demData && demData.header ? demData.header.ncols : 0);
                if (numCols > 0 && animationData[currentFrameIndex]) {
                    const frame = animationData[currentFrameIndex];
                    const idx = row * numCols + col;
                    if (idx >= 0 && idx < frame.length) {
                        const val = frame[idx];
                        if (val !== -9999) {
                            foundValue = { val: val.toFixed(2), label: 'Anim' };
                            break;
                        }
                    }
                }
            } else if (pane.type === 'qxqy') {
                const numRows = qxData.qx.length;
                const numCols = qxData.qx[0].length;
                if (row >= 0 && row < numRows && col >= 0 && col < numCols) {
                    const valX = qxData.qx[row][col];
                    const valY = qxData.qy[row][col];
                    const noData = qxData.noData || -9999;
                    if (valX !== noData && valY !== noData) {
                        const mag = Math.sqrt(valX * valX + valY * valY);
                        const rad = Math.atan2(valY, valX);
                        const deg = rad * (180 / Math.PI);

                        foundValue = { val: `Mag=${mag.toFixed(2)}, Deg=${deg.toFixed(1)}°`, label: 'QX/QY' };
                        break;
                    }
                }
            }
        }

        if (foundValue) {
            this.element.style.display = 'block';
            this.element.style.left = (e.originalEvent.pageX + 15) + 'px';
            this.element.style.top = (e.originalEvent.pageY + 15) + 'px';
            this.element.innerText = `${foundValue.label}: ${foundValue.val}`;
        } else {
            this.element.style.display = 'none';
        }
    }
}
