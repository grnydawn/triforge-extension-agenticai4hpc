
import { Tooltip } from './Tooltip';

export class ContextMenu {
    private element: HTMLElement;
    private toggleItem: HTMLElement;
    private tooltip: Tooltip;

    constructor(tooltip: Tooltip) {
        this.tooltip = tooltip;
        this.element = document.createElement('div');
        this.element.id = 'custom-context-menu';
        this.element.style.cssText = `
            display: none;
            position: absolute;
            z-index: 4000;
            background: #252526;
            color: #cccccc;
            border: 1px solid #3e3e42;
            padding: 4px 0;
            min-width: 120px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.3);
            border-radius: 4px;
            font-size: 13px;
            cursor: default;
        `;
        document.body.appendChild(this.element);

        this.toggleItem = document.createElement('div');
        this.updateLabel();
        this.toggleItem.style.cssText = `
            padding: 6px 12px;
            cursor: pointer;
        `;
        this.toggleItem.onmouseover = () => this.toggleItem.style.backgroundColor = '#37373d';
        this.toggleItem.onmouseout = () => this.toggleItem.style.backgroundColor = 'transparent';

        this.toggleItem.onclick = () => {
            const newState = !this.tooltip.isEnabled();
            this.tooltip.setEnabled(newState);
            this.updateLabel();
            this.element.style.display = 'none';
        };
        this.element.appendChild(this.toggleItem);

        // Global Listeners
        document.addEventListener('contextmenu', (e: MouseEvent) => this.onContextMenu(e));
        document.addEventListener('click', () => this.hide());
    }

    private updateLabel() {
        const enabled = this.tooltip.isEnabled();
        this.toggleItem.innerText = `Toggle Tooltip ${enabled ? '(Off)' : '(On)'}`;
    }

    private onContextMenu(e: MouseEvent) {
        // Prevent default
        e.preventDefault();

        const target = e.target as HTMLElement;
        const mapContainer = document.getElementById('map');

        // Show only if within map or on overlay canvas
        // Note: target.closest might fail if target is not in DOM anymore, check existence
        if ((mapContainer && mapContainer.contains(target)) || target.tagName.toLowerCase() === 'canvas') {
            this.element.style.display = 'block';
            this.element.style.left = `${e.clientX}px`;
            this.element.style.top = `${e.clientY}px`;
        } else {
            this.element.style.display = 'none';
        }
    }

    private hide() {
        this.element.style.display = 'none';
    }
}
