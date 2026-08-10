
import { MapController } from '../MapController';

export class VectorControl {
    private controller: MapController;

    constructor(controller: MapController) {
        this.controller = controller;
        this.setupEventListeners();
    }

    private setupEventListeners() {
        // Toggle Pane
        const toggleIcon = document.getElementById('qxqy-toggle-icon');
        const content = document.getElementById('qxqy-controls-content');
        if (toggleIcon && content) {
            toggleIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                const isHidden = content.style.display === 'none' || content.style.display === '';
                content.style.display = isHidden ? 'block' : 'none';
                toggleIcon.innerHTML = isHidden ? '&#9660;' : '&#9650;';
            });
            toggleIcon.style.cursor = 'pointer';
        }

        // Checkbox (Visibility)
        const checkbox = document.getElementById('qxqy-checkbox') as HTMLInputElement;
        if (checkbox) {
            checkbox.addEventListener('change', (e: any) => {
                this.controller.vectorLayer.toggle(e.target.checked);
            });
        }

        // Scale
        const scaleInput = document.getElementById('qxqy-scale-input') as HTMLInputElement;
        if (scaleInput) {
            scaleInput.addEventListener('change', (e: any) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val)) {
                    this.controller.vectorLayer.setOptions({ scale: val });
                }
            });
        }

        // Stride
        const strideInput = document.getElementById('qxqy-stride-input') as HTMLInputElement;
        if (strideInput) {
            strideInput.addEventListener('change', (e: any) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val) && val >= 1) {
                    this.controller.vectorLayer.setOptions({ stride: val });
                }
            });
        }

        // Color
        const colorPicker = document.getElementById('qxqy-color-picker') as HTMLInputElement;
        if (colorPicker) {
            colorPicker.addEventListener('change', (e: any) => {
                this.controller.vectorLayer.setOptions({ color: e.target.value });
            });
        }
    }
}
