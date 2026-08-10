export type DEMHeader = {
    ncols: number;
    nrows: number;
    xllcorner: number;
    yllcorner: number;
    cellsize: number;
    NODATA_value: number;
};

// --- Outgoing Messages (Extension -> Webview) ---

export type ToWebviewMessage =
    | { command: 'setCoordinates'; data: { lat: number; lng: number; zoom: number } }
    | { command: 'renderDem'; data: any } // Refine 'any' later (DemData)
    | { command: 'renderInitialInput'; data: any }
    | { command: 'renderQxQy'; data: any }
    | { command: 'renderStreamflow'; data: any }
    | { command: 'toggleDem'; data: { visible: boolean } }
    | { command: 'toggleStreamflow'; data: { visible: boolean } }
    | { command: 'startAnimationLoad' }
    | { command: 'appendAnimationFrame'; data: any } // Refine 'any' (pixels/frame data)
    | { command: 'endAnimationLoad' }
    | { command: 'zoomToExtent'; data: { north: number; south: number; east: number; west: number } }
    | { command: 'requestGifFrame'; data: { index: number } }
    | { command: 'setProjectHeader'; data: { header: DEMHeader; utmZone: string; datum: string; simStartTime?: string; timezone?: string; printInterval?: number } }
    | { command: 'clearDem' }
    | { command: 'clearInitialInput' }
    | { command: 'clearQxQy' }
    | { command: 'clearStreamflow' }
    | { command: 'toggleAnimationPane'; visible: boolean }
    | { command: 'initSelectionMode'; cellSize: number }
    | { command: 'unfoldControls' }
    | { command: 'activateLayer'; data: { layer: string } };

// --- Incoming Messages (Webview -> Extension) ---

export type FromWebviewMessage =
    | { command: 'alert'; text: string }
    | { command: 'info'; text: string }
    | { command: 'error'; text: string } // Standardized error logging
    | { command: 'toggleDem'; data: { visible: boolean } }
    | { command: 'toggleQxQy'; data: { visible: boolean } }
    | { command: 'toggleStreamflow'; data: { visible: boolean } }
    | { command: 'triggerLoadAnimation' }
    | { command: 'gifFrameData'; data: { index: number; pixels: number[] } }
    | { command: 'downloadGif'; data: { fps: number } } // If implemented
    | { command: 'cropSelection'; data: { x: number; y: number; width: number; height: number } } // For MapSelector
    | { command: 'webviewReady' };
