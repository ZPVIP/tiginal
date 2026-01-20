import React, { useState, useRef, useEffect, useCallback } from 'react';
import { clsx } from 'clsx';
import { PaneContainer } from './PaneContainer';
import { TerminalRef } from './TerminalInstance';

// Types from our Plan
export interface Pane {
    id: string;
    cwd: string;
}

export interface Column {
    id: string;
    panes: Pane[]; // Max 2
    splitRatio: number; // 0-1, defaults to 0.5. Top pane height ratio.
}

interface SplitLayoutProps {
    columns: Column[];
    activePaneId: string;
    maximizedPaneId: string | null;
    // Callbacks
    onPaneActivate: (id: string) => void;
    onTitleChange: (id: string, title: string) => void;
    onExit: (id: string) => void;
    
    // Layout Updaters
    onResizeColumn: (colIndex: number, newRatio: number) => void;
    onResizePane: (colId: string, newRatio: number) => void;
    
    // Terminal Refs Map
    registerTerminalRef: (id: string, ref: TerminalRef | null) => void;
    
    // Context Menu
    onContextMenu: (e: React.MouseEvent, paneId: string) => void;
}

export function SplitLayout({
    columns,
    activePaneId,
    maximizedPaneId,
    columnRatios = [],
    onPaneActivate,
    onTitleChange,
    onExit,
    onResizePane,
    onResizeColumn,
    registerTerminalRef,
    onContextMenu
}: SplitLayoutProps & { columnRatios?: number[] }) {
    
    // Drag State
    const [dragging, setDragging] = useState<{
        type: 'column' | 'row';
        id: string; // colId for row drag, or index for column drag
        startX: number;
        startY: number;
        startRatio: number;
        containerSize: number;
    } | null>(null);

    const layoutRef = useRef<HTMLDivElement>(null);
    const colRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    // NOTE: Column resizing is tricky with Flexbox unless we store precise widths.
    // For MVP, we said balanced columns, or just equal? 
    // Plan said "columnRatios" in TabLayout. Let's assume equal width for now to simplify,
    // OR we can implement column resizing later. The user prompt mentioned "4 vertical lines".
    // So resizing columns is expected.
    // However, to keep it simple for step 1, let's use equal columns (flex-1) 
    // and focus on PANE resizing first.
    // Wait, requirement: "拉动边界线可以调节窗口大小 (vertical & horizontal)"
    // Okay, we need column resizing too. But let's start with Pane (Vertical Split) resizing.

    // --- Drag Handlers ---

    const handleMouseDown = (e: React.MouseEvent, type: 'row' | 'column', id: string, currentRatio: number) => {
        e.preventDefault();
        e.stopPropagation();
        
        let containerSize = 0;
        
        if (type === 'row') {
            const colEl = colRefs.current.get(id);
            containerSize = colEl?.clientHeight || 0;
        } else {
            // For column, container is the whole width
            containerSize = layoutRef.current?.clientWidth || 0;
        }

        if (containerSize === 0) return;

        setDragging({
            type,
            id,
            startX: e.clientX,
            startY: e.clientY,
            startRatio: currentRatio,
            containerSize
        });
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!dragging) return;
            
            if (dragging.type === 'row') {
                const deltaY = e.clientY - dragging.startY;
                const deltaRatio = deltaY / dragging.containerSize;
                const newRatio = Math.min(Math.max(dragging.startRatio + deltaRatio, 0.1), 0.9);
                onResizePane(dragging.id, newRatio);
            } else if (dragging.type === 'column') {
                const colIndex = parseInt(dragging.id);
                // Delta X as percentage of TOTAL width
                const deltaX = e.clientX - dragging.startX;
                const deltaRatio = deltaX / dragging.containerSize;
                
                // We are resizing divider at colIndex (modifying colIndex and colIndex+1)
                // Actually, logic is: change sizes of columns[colIndex] and columns[colIndex+1]
                // But the helper `onResizeColumn` handles the math hopefully?
                // Or we pass just the delta? 
                // Let's pass the raw delta ratio to parent to handle the array math.
                onResizeColumn(colIndex, deltaRatio);
                
                // Reset startX to avoid accumulation errors if we wanted, 
                // BUT better to rely on absolute displacement from start if we pass "newRatio"
                // The parent expects "newRatio"? 
                // Actually `onResizeColumn` signature is (index, newRatio).
                // But "newRatio" of WHAT? Left column?
                // Yes, simpler: pass the new Ratio of the LEFT column (colIndex).
                // Wait, if we change Left, Right must change too.
                // Standard approach: Parent manages the array. We tell it "Column i is now X%".
                // But we need to know the STARTRatio of that specific column.
                // startRatio stored in state IS the ratio of colIndex.
                
                // Let's assume onResizeColumn(index, delta) is better? No, plan said (index, newRatio).
                // Let's calculate new width for column[index].
                
                const newLeftRatio = dragging.startRatio + deltaRatio;
                // Constraints handled by parent or here?
                // Let's pass it up.
                onResizeColumn(colIndex, newLeftRatio);
            }
        };

        const handleMouseUp = () => {
            setDragging(null);
        };

        if (dragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = dragging.type === 'row' ? 'row-resize' : 'col-resize';
        } else {
            document.body.style.cursor = '';
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = '';
        };
    }, [dragging, onResizePane, onResizeColumn]);


    // Determine widths
    // If columnRatios provided, use them. Else equal.
    const getColWidth = (idx: number) => {
        if (columnRatios && columnRatios.length === columns.length) {
            return `${columnRatios[idx] * 100}%`;
        }
        return `${100 / columns.length}%`;
    };

    // Helper to count total panes
    const totalPanes = columns.reduce((acc, col) => acc + col.panes.length, 0);

    // Check if maximized
    const isMaximized = !!maximizedPaneId;

    return (
        <div ref={layoutRef} className="flex h-full w-full relative">
            {columns.map((col, idx) => {
                const isMultiPane = col.panes.length > 1;
                const topHeight = isMultiPane ? `${col.splitRatio * 100}%` : '100%';
                
                // Check if this column contains the maximized pane
                const colHasMaximizedPane = isMaximized && col.panes.some(p => p.id === maximizedPaneId);
                // Hide column if maximized mode is on and this column doesn't have the maximized pane
                const hideColumn = isMaximized && !colHasMaximizedPane;
                
                return (
                    <React.Fragment key={col.id}>
                        {/* Vertical Divider (Resizer) - hide when maximized */}
                        {idx > 0 && !isMaximized && (
                            <div
                                className="w-1 hover:bg-primary cursor-col-resize z-30 shrink-0 transition-colors bg-border relative -ml-0.5"
                                onMouseDown={(e) => {
                                    const leftColIdx = idx - 1;
                                    const currentWidthRatio = columnRatios[leftColIdx] || (1 / columns.length);
                                    handleMouseDown(e, 'column', leftColIdx.toString(), currentWidthRatio);
                                }}
                            />
                        )}

                        <div 
                            ref={el => { if(el) colRefs.current.set(col.id, el); }}
                            className={clsx(
                                "flex flex-col h-full overflow-hidden relative min-w-0 transition-[width] duration-0",
                                hideColumn && "hidden"
                            )}
                            style={{ width: isMaximized && colHasMaximizedPane ? '100%' : getColWidth(idx) }}
                        >
                            {/* Top Pane (or Only Pane) */}
                            {col.panes[0] && (() => {
                                const pane = col.panes[0];
                                const isPaneMaximized = maximizedPaneId === pane.id;
                                const hidePane = isMaximized && !isPaneMaximized;
                                
                                return (
                                    <div 
                                        key={pane.id}
                                        style={{ height: isMaximized ? (isPaneMaximized ? '100%' : '0') : topHeight }} 
                                        className={clsx(
                                            "relative min-h-0 flex flex-col",
                                            hidePane && "hidden"
                                        )}
                                    >
                                        <div className={clsx(
                                            "flex-1 relative overflow-hidden flex flex-col transition-colors duration-200 border",
                                            (!isMaximized && totalPanes > 1 && activePaneId === pane.id) 
                                                ? "border-[var(--split-border-active)]" 
                                                : "border-transparent"
                                        )}>
                                            <PaneContainer
                                                key={pane.id}
                                                id={pane.id}
                                                isActive={activePaneId === pane.id}
                                                onActivate={onPaneActivate}
                                                onTitleChange={onTitleChange}
                                                onExit={onExit}
                                                terminalRef={(ref) => registerTerminalRef(pane.id, ref)}
                                                onContextMenu={(e) => {
                                                    e.preventDefault();
                                                    onContextMenu(e, pane.id);
                                                }}
                                            />
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* Splitter - hide when maximized */}
                            {isMultiPane && !isMaximized && (
                                <div 
                                    className="h-1 bg-border hover:bg-primary cursor-row-resize z-20 shrink-0 transition-colors"
                                    onMouseDown={(e) => handleMouseDown(e, 'row', col.id, col.splitRatio)}
                                />
                            )}

                            {/* Bottom Pane */}
                            {isMultiPane && col.panes[1] && (() => {
                                const pane = col.panes[1];
                                const isPaneMaximized = maximizedPaneId === pane.id;
                                const hidePane = isMaximized && !isPaneMaximized;
                                
                                return (
                                    <div 
                                        key={pane.id}
                                        className={clsx(
                                            "flex-1 relative min-h-0 flex flex-col",
                                            hidePane && "hidden"
                                        )}
                                        style={{ height: isMaximized && isPaneMaximized ? '100%' : undefined }}
                                    >
                                        <div className={clsx(
                                            "flex-1 relative overflow-hidden flex flex-col transition-colors duration-200 border",
                                            (!isMaximized && totalPanes > 1 && activePaneId === pane.id) 
                                                ? "border-[var(--split-border-active)]" 
                                                : "border-transparent"
                                        )}>
                                            <PaneContainer
                                                key={pane.id}
                                                id={pane.id}
                                                isActive={activePaneId === pane.id}
                                                onActivate={onPaneActivate}
                                                onTitleChange={onTitleChange}
                                                onExit={onExit}
                                                terminalRef={(ref) => registerTerminalRef(pane.id, ref)}
                                                onContextMenu={(e) => {
                                                    e.preventDefault();
                                                    onContextMenu(e, pane.id);
                                                }}
                                            />
                                        </div>
                                    </div>
                                );
                            })()}
                            
                        </div>
                    </React.Fragment>
                );
            })}
        </div>
    );
}

