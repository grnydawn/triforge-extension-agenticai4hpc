
export class DraggablePanes {
    private container: HTMLElement;

    constructor() {
        this.container = document.getElementById('controls-container')!;
        if (!this.container) return;

        this.init();
    }

    private init() {
        const draggables = document.querySelectorAll('.floating-controls');

        draggables.forEach(elem => {
            const draggable = elem as HTMLElement;

            // Use mousedown to decide if the element should be draggable
            // this is more reliable than preventing default in dragstart
            draggable.addEventListener('mousedown', (e) => {
                const target = e.target as HTMLElement;
                const isInteractive =
                    target.tagName === 'INPUT' ||
                    target.tagName === 'SELECT' ||
                    target.tagName === 'BUTTON' ||
                    target.closest('.icon-btn') !== null ||
                    target.closest('canvas') !== null; // Canvas legends

                if (isInteractive) {
                    draggable.draggable = false;
                } else {
                    draggable.draggable = true;
                }
            });

            draggable.addEventListener('dragstart', () => {
                draggable.classList.add('dragging');
            });

            draggable.addEventListener('dragend', () => {
                draggable.classList.remove('dragging');
                this.updateLayerOrder();
            });
        });

        this.container.addEventListener('dragover', e => {
            e.preventDefault();
            const afterElement = this.getDragAfterElement(this.container, e.clientX);
            const draggable = document.querySelector('.dragging');
            if (afterElement == null) {
                if (draggable) this.container.appendChild(draggable);
            } else {
                if (draggable) this.container.insertBefore(draggable, afterElement);
            }
        });

        this.container.addEventListener('drop', () => {
            this.updateLayerOrder();
        });
    }

    private getDragAfterElement(container: HTMLElement, x: number) {
        const draggableElements = Array.from(container.querySelectorAll('.floating-controls:not(.dragging)'));

        return draggableElements.reduce((closest: any, child: any) => {
            const box = child.getBoundingClientRect();
            // Calculate horizontal offset from center of box
            const offset = x - box.left - box.width / 2;

            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
    }

    private updateLayerOrder() {
        // Dispatch custom event so Controller can handle z-indexes
        const event = new CustomEvent('layerOrderChanged');
        window.dispatchEvent(event);
    }

    public movePaneToLeft(paneId: string) {
        const pane = document.getElementById(paneId);
        if (pane && this.container) {
            this.container.prepend(pane);
            this.updateLayerOrder();
        }
    }
}
