export class CropManager {
    private cropBox: HTMLElement;
    private isCropping: boolean = false;
    private activeDrag: string | null = null;
    private startX: number = 0;
    private startY: number = 0;
    private startLeft: number = 0;
    private startTop: number = 0;
    private startW: number = 0;
    private startH: number = 0;

    private onConfirm: (rect: { x: number, y: number, w: number, h: number }) => void;
    private onCancel: () => void;

    constructor(container: HTMLElement, onConfirm: (rect: { x: number, y: number, w: number, h: number }) => void, onCancel: () => void) {
        this.onConfirm = onConfirm;
        this.onCancel = onCancel;

        this.cropBox = document.createElement('div');
        this.cropBox.id = 'crop-box';

        // Add handles
        const handles = ['nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e'];
        handles.forEach(h => {
            const handle = document.createElement('div');
            handle.className = `crop-handle ${h}`;
            this.cropBox.appendChild(handle);
        });

        container.appendChild(this.cropBox);

        // Prevent map interaction while over the crop box
        const L = (window as any).L;
        if (L) {
            L.DomEvent.disableClickPropagation(this.cropBox);
            // Allow scroll/wheel to propagate to map for zooming
            // L.DomEvent.disableScrollPropagation(this.cropBox);
        }

        this.setupEventListeners();
    }

    private setupEventListeners() {
        this.cropBox.addEventListener('mousedown', (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.classList.contains('crop-handle')) {
                const handleClass = Array.from(target.classList).find(c => c !== 'crop-handle');
                this.activeDrag = handleClass || 'move';
            } else {
                this.activeDrag = 'move';
            }
            this.startX = e.clientX;
            this.startY = e.clientY;
            this.startLeft = this.cropBox.offsetLeft;
            this.startTop = this.cropBox.offsetTop;
            this.startW = this.cropBox.offsetWidth;
            this.startH = this.cropBox.offsetHeight;
            e.stopPropagation();
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e: MouseEvent) => {
            if (!this.isCropping || !this.activeDrag) return;

            e.stopPropagation();
            e.preventDefault();

            const dx = e.clientX - this.startX;
            const dy = e.clientY - this.startY;

            if (this.activeDrag === 'move') {
                this.cropBox.style.left = (this.startLeft + dx) + 'px';
                this.cropBox.style.top = (this.startTop + dy) + 'px';
            } else {
                let newW = this.startW, newH = this.startH, newL = this.startLeft, newT = this.startTop;

                if (this.activeDrag.includes('e')) newW = this.startW + dx;
                if (this.activeDrag.includes('s')) newH = this.startH + dy;
                if (this.activeDrag.includes('w')) {
                    newW = this.startW - dx;
                    newL = this.startLeft + dx;
                }
                if (this.activeDrag.includes('n')) {
                    newH = this.startH - dy;
                    newT = this.startTop + dy;
                }

                // Minimum size constraints
                if (newW > 40) {
                    this.cropBox.style.width = newW + 'px';
                    this.cropBox.style.left = newL + 'px';
                }
                if (newH > 40) {
                    this.cropBox.style.height = newH + 'px';
                    this.cropBox.style.top = newT + 'px';
                }
            }
        });

        window.addEventListener('mouseup', (e: MouseEvent) => {
            if (this.isCropping && this.activeDrag) {
                e.stopPropagation();
                e.preventDefault();
            }
            this.activeDrag = null;
        });

        window.addEventListener('keydown', (e: KeyboardEvent) => {
            if (!this.isCropping) return;
            if (e.key === 'Enter') {
                const rect = {
                    x: this.cropBox.offsetLeft,
                    y: this.cropBox.offsetTop,
                    w: this.cropBox.offsetWidth,
                    h: this.cropBox.offsetHeight
                };
                this.stop();
                this.onConfirm(rect);
            } else if (e.key === 'Escape') {
                this.stop();
                this.onCancel();
            }
        });
    }

    public start() {
        console.log('[CropManager] start called');
        this.isCropping = true;
        this.cropBox.style.display = 'block';
        console.log('[CropManager] cropBox display set to block');

        // Center the box initially or use default
        const mapContainer = this.cropBox.parentElement!;
        const w = 400, h = 300;
        const cw = mapContainer.clientWidth;
        const ch = mapContainer.clientHeight;
        console.log(`[CropManager] Container size: ${cw}x${ch}`);

        this.cropBox.style.width = w + 'px';
        this.cropBox.style.height = h + 'px';
        this.cropBox.style.left = (cw / 2 - w / 2) + 'px';
        this.cropBox.style.top = (ch / 2 - h / 2) + 'px';
    }

    public stop() {
        this.isCropping = false;
        this.cropBox.style.display = 'none';
        this.activeDrag = null;
    }
}
