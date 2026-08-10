import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ProjectManager } from '../state/ProjectManager';
import { Logger } from '../utils/Logger';
import { MapEditor } from '../panels/MapEditor';
import { SimulationsView, RecursiveFileNode } from '../views/SimulationsView';
import { FileTypeDetector } from '../utils/FileTypeDetector';
import { BinaryParser } from '../parsers/BinaryParser';
import { AsciiParser } from '../parsers/AsciiParser';
import { VrtParser } from '../parsers/VrtParser';

export function registerAnimationCommands(context: vscode.ExtensionContext, explorerTreeView: vscode.TreeView<RecursiveFileNode>) {


    const loadAnimationDisposable = vscode.commands.registerCommand('triforge.loadAnimation', async (_node: RecursiveFileNode, _selectedNodes?: RecursiveFileNode[]) => {
        try {
            Logger.info('[Command] triforge.loadAnimation: Starting animation load.');

            const activeProject = ProjectManager.instance.activeProject;
            if (!activeProject) {
                const msg = 'No active project.';
                Logger.warn(`[Command] triforge.loadAnimation: ${msg}`);
                vscode.window.showErrorMessage(msg);
                return;
            }

            const mapEditor = MapEditor.revealAndUnfold(context.extensionUri, activeProject);

            if (!mapEditor) {
                const msg = 'Failed to open Map Editor.';
                Logger.error(`[Command] triforge.loadAnimation: ${msg}`);
                vscode.window.showErrorMessage(msg);
                return;
            }

            // Small delay to ensure webview is ready if it was just created
            await new Promise(resolve => setTimeout(resolve, 500));

            mapEditor.ensureDemVisible();
            await mapEditor.loadDemIfAvailable();

            const demData = mapEditor.currentDemData;
            if (!demData) {
                const msg = 'DEM not loaded in Map. Cannot align animation frames.';
                Logger.warn(`[Command] triforge.loadAnimation: ${msg}`);
                vscode.window.showErrorMessage(msg);
                return;
            }

            const demHeader = {
                lastCols: demData.header.ncols,
                lastRows: demData.header.nrows,
                noData: demData.header.NODATA_value
            };

            let nodesToProcess: any[] = [];
            if (_selectedNodes && Array.isArray(_selectedNodes) && _selectedNodes.length > 0) {
                nodesToProcess = [..._selectedNodes];
            } else if (_node) {
                nodesToProcess = [_node];
            } else {
                const currentSelection = explorerTreeView.selection;
                if (currentSelection && currentSelection.length > 0) {
                    nodesToProcess = [...currentSelection];
                } else if (SimulationsView.currentSelection && SimulationsView.currentSelection.length > 0) {
                    // Fallback to tracked selection (useful when focus is in Webview)
                    nodesToProcess = [...SimulationsView.currentSelection];
                }
            }

            if (nodesToProcess.length === 0) {
                Logger.warn('[Command] No nodes to process after selection check.');
                vscode.window.showWarningMessage('No data files selected. Please select animation files in the Explorer sidebar.', { modal: true });
                return;
            }

            // Expand Categories and Folders
            const finalNodes: RecursiveFileNode[] = [];

            for (const n of nodesToProcess) {
                if (n.contextValue === 'outputCategory' || n.category) {
                    // It's a category node, get children
                    const children = await n.getChildren();
                    finalNodes.push(...children);
                } else if (n.isDirectory) {
                    const children = await n.getChildren();
                    finalNodes.push(...children);
                } else {
                    finalNodes.push(n);
                }
            }

            // Validate that files belong to the active project
            // Validate that files belong to the active project
            const validNodes: RecursiveFileNode[] = [];
            const invalidNodes: RecursiveFileNode[] = [];

            for (const node of finalNodes) {
                if (!node.fullPath) continue;

                function checkContainment(child: string, parent: string): boolean {
                    const childLower = child.toLowerCase();
                    const parentLower = parent.toLowerCase();
                    const rel = path.relative(parentLower, childLower);
                    return !rel.startsWith('..') && !path.isAbsolute(rel);
                }

                // 1. Literal Check (Fast, covers standard cases)
                const literalNode = node.fullPath;
                const literalProject = activeProject.path;
                let isInsideProject = checkContainment(literalNode, literalProject);

                // 2. Canonical Check (Covers symlinks, but can fail if resolution mismatched)
                let canonicalNode = literalNode;
                let canonicalProject = literalProject;
                try {
                    if (fs.existsSync(canonicalNode)) canonicalNode = fs.realpathSync(canonicalNode);
                    if (fs.existsSync(canonicalProject)) canonicalProject = fs.realpathSync(canonicalProject);

                    if (!isInsideProject) {
                        isInsideProject = checkContainment(canonicalNode, canonicalProject);
                    }
                } catch (e) {
                    Logger.warn(`[Command] Path resolution failed: ${e}`);
                }

                Logger.info(`[Command] Validating ${literalNode} vs ${literalProject} -> Inside: ${isInsideProject}`);

                // 3. Output Directory Check (Literal + Canonical)
                let isInsideOutput = false;
                if (activeProject.outputs?.output_directory) {
                    const literalOutput = activeProject.outputs.output_directory;
                    isInsideOutput = checkContainment(literalNode, literalOutput);

                    if (!isInsideOutput) {
                        try {
                            let canonicalOutput = literalOutput;
                            if (fs.existsSync(canonicalOutput)) canonicalOutput = fs.realpathSync(canonicalOutput);
                            isInsideOutput = checkContainment(canonicalNode, canonicalOutput);
                        } catch (e) { }
                    }
                    Logger.info(`[Command] Validating vs Output ${literalOutput} -> Inside: ${isInsideOutput}`);
                }

                if (isInsideProject || isInsideOutput) {
                    validNodes.push(node);
                } else {
                    invalidNodes.push(node);
                }
            }

            let nodesToUse = validNodes;

            if (invalidNodes.length > 0) {
                Logger.warn(`[Command] Found ${invalidNodes.length} files outside active project.`);

                const message = `Warning: ${invalidNodes.length} files appear to be outside the active project '${activeProject.name}'. Do you want to load them anyway?`;
                const selection = await vscode.window.showWarningMessage(message, { modal: true }, 'Load Anyway', 'Cancel');

                if (selection === 'Load Anyway') {
                    nodesToUse = [...validNodes, ...invalidNodes];
                } else {
                    return; // Abort
                }
            }

            // Validate Mixed Types
            let hasGeotiff = false;
            let hasBinary = false;
            let hasAscii = false;
            let hasVrt = false;

            for (const node of nodesToUse) {
                if (!node.fullPath) continue;
                const type = FileTypeDetector.detect(node.fullPath);

                if (type === 'geotiff') {
                    hasGeotiff = true;
                } else if (type === 'vrt') {
                    hasVrt = true;
                } else if (type === 'binary') {
                    hasBinary = true;
                } else if (type === 'ascii') {
                    hasAscii = true;
                }
            }

            // Check for mixing
            let typesFound = 0;
            if (hasGeotiff) typesFound++;
            if (hasBinary) typesFound++;
            if (hasAscii) typesFound++;
            if (hasVrt) typesFound++;

            if (typesFound > 1) {
                vscode.window.showWarningMessage('Warning: You have selected multiple data types (e.g. Geotiff and Binary). Please select only one type of data for animation.', { modal: true });
                return;
            }

            nodesToProcess = nodesToUse;

            if (nodesToProcess.length === 0) {
                vscode.window.showWarningMessage('No valid files found in selection.', { modal: true });
                return;
            }

            // Collect Content-Based VRTs
            const vrtPaths: string[] = [];
            for (const n of nodesToProcess) {
                if (n.fullPath && !n.isDirectory) {
                    if (FileTypeDetector.detect(n.fullPath) === 'vrt') {
                        vrtPaths.push(n.fullPath);
                    }
                }
            }

            const asciiPaths: string[] = [];
            const binaryPaths: string[] = [];

            for (const node of nodesToProcess) {
                if (!node || !node.fullPath) continue;
                if (!node.isDirectory) {
                    const type = FileTypeDetector.detect(node.fullPath);

                    if (type === 'vrt') {
                        // Handled via getVrtPaths logic or here? 
                        // getVrtPaths logic below iterates again. 
                        // Let's let the getVrtPaths call handle VRTs or consolidate.
                        // Actually, the original code called `getVrtPathsFromNodes` specifically.
                        // But now we can detect VRT by content.
                    } else if (type === 'binary') {
                        binaryPaths.push(node.fullPath);
                    } else if (type === 'ascii') {
                        asciiPaths.push(node.fullPath);
                    }
                }
            }

            let mode: 'vrt' | 'ascii' | 'binary' = 'vrt';
            const sortedBinaryGroups: { frame: number; files: string[]; name: string }[] = [];
            const sortedAsciiGroups: { frame: number; files: string[]; name: string }[] = [];

            if (binaryPaths.length > 0) {
                mode = 'binary';
                const groups = new Map<string, { files: string[], baseName: string, frame: number }>();

                for (const p of binaryPaths) {
                    const fname = path.basename(p);
                    // MATCH: name_Frame_Subdomain
                    // Regex relaxed to catch any name + digits + digits + ext
                    const match = fname.match(/^(.*)_(\d+)_(\d+)\.[a-zA-Z0-9]+$/);
                    // Also support single file sequence: Name_Frame.ext
                    const matchSingle = fname.match(/^(.*)_(\d+)\.[a-zA-Z0-9]+$/);

                    if (match) {
                        const baseName = match[1];
                        const frameNum = parseInt(match[2]);
                        const key = `${baseName}_${frameNum}`;

                        if (!groups.has(key)) {
                            groups.set(key, { files: [], baseName: `${baseName}_Frame${frameNum}`, frame: frameNum });
                        }
                        groups.get(key)!.files.push(p);
                    } else if (matchSingle) {
                        const baseName = matchSingle[1];
                        const frameNum = parseInt(matchSingle[2]);
                        const key = `${baseName}_${frameNum}`;
                        if (!groups.has(key)) {
                            groups.set(key, { files: [], baseName: fname, frame: frameNum });
                        }
                        groups.get(key)!.files.push(p);
                    }
                }

                const groupValues = Array.from(groups.values());
                for (const grp of groupValues) {
                    grp.files.sort((a, b) => {
                        const ma = path.basename(a).match(/_(\d+)\.out$/);
                        const mb = path.basename(b).match(/_(\d+)\.out$/);
                        const sa = ma ? parseInt(ma[1]) : 0;
                        const sb = mb ? parseInt(mb[1]) : 0;
                        return sa - sb;
                    });
                    sortedBinaryGroups.push({ frame: grp.frame, files: grp.files, name: grp.baseName });
                }
                // Sort frames
                sortedBinaryGroups.sort((a, b) => a.frame - b.frame);
            } else if (asciiPaths.length > 0) {
                mode = 'ascii';
                const groups = new Map<string, { files: string[], baseName: string, frame: number }>();


                for (const p of asciiPaths) {
                    const fname = path.basename(p);

                    // Regex relaxed for any extension
                    const match = fname.match(/^(.*)_(\d+)_(\d+)\.[a-zA-Z0-9]+$/i);
                    const matchSingle = fname.match(/^(.*)_(\d+)\.[a-zA-Z0-9]+$/i);

                    if (match) {
                        const baseName = match[1];
                        const frameNum = parseInt(match[2]);
                        const key = `${baseName}_${frameNum}`;

                        if (!groups.has(key)) {
                            groups.set(key, { files: [], baseName: `${baseName}_Frame${frameNum}`, frame: frameNum });
                        }
                        groups.get(key)!.files.push(p);
                    } else if (matchSingle) {
                        const baseName = matchSingle[1];
                        const frameNum = parseInt(matchSingle[2]);
                        const key = `${baseName}_${frameNum}`;
                        if (!groups.has(key)) {
                            groups.set(key, { files: [], baseName: fname, frame: frameNum });
                        }
                        groups.get(key)!.files.push(p);
                    } else {
                        const simpleKey = fname;
                        if (!groups.has(simpleKey)) {
                            groups.set(simpleKey, { files: [p], baseName: fname, frame: 0 });
                        }
                    }
                }

                const groupValues = Array.from(groups.values());
                for (const grp of groupValues) {
                    grp.files.sort((a, b) => {
                        // Sort chunks if split? Or just take file.
                        // Usually ACSII grids are single file or tiled.
                        // If tiled, similar logic to binary.
                        const ma = path.basename(a).match(/_(\d+)\.(asc|dat|txt)$/i);
                        const mb = path.basename(b).match(/_(\d+)\.(asc|dat|txt)$/i);
                        const sa = ma ? parseInt(ma[1]) : 0;
                        const sb = mb ? parseInt(mb[1]) : 0;
                        return sa - sb;
                    });
                    sortedAsciiGroups.push({ frame: grp.frame, files: grp.files, name: grp.baseName });
                }
                // Sort frames
                sortedAsciiGroups.sort((a, b) => a.frame - b.frame);
            }

            const totalFrames = mode === 'binary' ? sortedBinaryGroups.length : (mode === 'ascii' ? sortedAsciiGroups.length : vrtPaths.length);
            Logger.info(`[Command] Loading ${totalFrames} frames from ${mode}...`);

            if (totalFrames === 0) {
                vscode.window.showWarningMessage('No valid animation data files (.asc, .out, .vrt) found in your selection. Please check your Explorer sidebar selection.', { modal: true });
                return;
            }

            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Loading ${totalFrames} Frames (${mode})...`,
                cancellable: true
            }, async (progress, token) => {
                await mapEditor.startAnimationLoad();
                let successCount = 0;
                let lastError = '';

                for (let i = 0; i < totalFrames; i++) {
                    if (token.isCancellationRequested) break;

                    let name = '';
                    let matrix: Float32Array | null = null;

                    try {
                        if (mode === 'binary') {
                            const grp = sortedBinaryGroups[i];
                            name = grp.name;
                            matrix = await BinaryParser.stitchFiles(grp.files, demHeader);
                        } else if (mode === 'ascii') {
                            const grp = sortedAsciiGroups[i];
                            name = grp.name;
                            matrix = await AsciiParser.stitchFiles(grp.files, demHeader);
                        } else {
                            const p = vrtPaths[i];
                            name = path.basename(p);
                            matrix = await VrtParser.parseToMatrix(p, demHeader);
                        }

                        progress.report({ message: `${name} (${i + 1}/${totalFrames})`, increment: (100 / totalFrames) });

                        if (matrix) {
                            await mapEditor.appendFrame(matrix, name, i, totalFrames);
                            successCount++;
                        } else {
                            if (!lastError) lastError = `Unparsable: ${name}`;
                            Logger.warn(`[Command] Failed to parse frame ${i}: ${name}`);
                        }

                    } catch (e) {
                        lastError = `${e}`;
                        Logger.error(`[Command] Error processing frame ${i}: ${e}`);
                    }
                }

                if (successCount === 0) {
                    vscode.window.showErrorMessage(`Animation Load Failed. No valid frames generated. Last Error: ${lastError}`);
                } else {
                    Logger.info(`[Command] Successfully loaded ${successCount}/${totalFrames} frames.`);
                }

                await mapEditor.endAnimationLoad();
            });

        } catch (err: any) {
            Logger.error(`[Command] triforge.loadAnimation Unhandled Error: ${err.message}`);
            vscode.window.showErrorMessage(`Error loading animation: ${err.message}`);
        }
    });

    context.subscriptions.push(loadAnimationDisposable);
}
