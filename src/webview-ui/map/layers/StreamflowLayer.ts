// import { ProjectionManager } from '../ProjectionManager';

declare const L: any;

export interface StreamflowSource {
    x: number;
    y: number;
    values: number[];
}

export class StreamflowLayer {
    private map: any;
    private layerGroup: any;
    private data: StreamflowSource[] = [];
    private lockedMarker: any = null;

    constructor(map: any) {
        this.map = map;
        this.layerGroup = L.layerGroup().addTo(map);

        // Global Escape listener to close locked popup
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.lockedMarker) {
                this.lockedMarker.closePopup();
                this.lockedMarker = null;
            }
        });
    }

    public setData(data: StreamflowSource[]) {
        this.data = data;
        this.render();
    }

    public toggle(visible: boolean) {
        if (visible) {
            this.map.addLayer(this.layerGroup);
        } else {
            this.map.removeLayer(this.layerGroup);
        }
    }

    public clear() {
        this.layerGroup.clearLayers();
        this.data = [];
        this.lockedMarker = null;
    }

    private render() {
        this.layerGroup.clearLayers();

        if (!this.data || this.data.length === 0) return;

        this.data.forEach((source, index) => {
            const marker = L.circleMarker([source.x, source.y], {
                radius: 6,
                fillColor: '#007bff',
                color: '#fff',
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8
            });

            // Popup Content
            let content = `<div style="font-weight: bold; margin-bottom: 4px;">Source #${index + 1}</div>`;
            content += `<div style="max-height: 150px; overflow-y: auto; font-family: monospace; font-size: 11px;">`;

            if (source.values && source.values.length > 0) {
                source.values.forEach((val, t) => {
                    content += `<div>T=${t}: ${val.toFixed(4)}</div>`;
                });
            } else {
                content += `<div>No Data</div>`;
            }
            content += `</div>`;

            // Bind Popup instead of Tooltip for interaction
            marker.bindPopup(content, {
                autoClose: false,
                closeOnClick: false,
                closeButton: false,
                className: 'streamflow-popup'
            });

            // Interaction Logic
            marker.on('mouseover', () => {
                if (!this.lockedMarker) {
                    marker.openPopup();
                }
            });

            marker.on('mouseout', () => {
                if (this.lockedMarker !== marker) {
                    marker.closePopup();
                }
            });

            marker.on('click', () => {
                if (this.lockedMarker && this.lockedMarker !== marker) {
                    this.lockedMarker.closePopup();
                }
                this.lockedMarker = marker;
                marker.openPopup();
            });

            marker.addTo(this.layerGroup);
        });
    }
}
