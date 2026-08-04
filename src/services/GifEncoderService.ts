import * as fs from 'fs';

export class GifEncoderService {
    private encoder: any;
    private outputPath: string = '';
    private totalFrames: number = 0;
    private currentFrame: number = 0;

    constructor() { }

    public start(width: number, height: number, delay: number, destinationPath: string, totalFrames: number): void {
        this.outputPath = destinationPath;
        this.totalFrames = totalFrames;
        this.currentFrame = 0;

        const GIFEncoder = require('gif-encoder-2');
        this.encoder = new GIFEncoder(width, height);
        this.encoder.setDelay(delay);
        this.encoder.start();
    }

    public addFrame(pixels: number[]): void {
        if (!this.encoder) {
            throw new Error("GIF Encoder not started");
        }
        const buffer = Buffer.from(pixels);
        this.encoder.addFrame(buffer);
        this.currentFrame++;
    }

    public isFinished(): boolean {
        return this.currentFrame >= this.totalFrames;
    }

    public getProgress(): { current: number, total: number } {
        return { current: this.currentFrame, total: this.totalFrames };
    }

    public async finish(): Promise<void> {
        if (!this.encoder) return;

        this.encoder.finish();
        const outBuffer = this.encoder.out.getData();

        await fs.promises.writeFile(this.outputPath, outBuffer);

        // Cleanup
        this.encoder = null;
        this.outputPath = '';
    }

    public cancel(): void {
        this.encoder = null;
        this.outputPath = '';
    }
}
