import React, { useEffect, useMemo, useRef } from 'react';
import { FileTree, useFileTree, useFileTreeSelection } from '@pierre/trees/react';
import type { CSSProperties } from 'react';
import type { CredentialFileLocation } from '../../../shared/credentials/types';

interface CredentialLocationTreeProps {
  locations: CredentialFileLocation[];
  selectedFileId: string | null;
  onSelect: (location: CredentialFileLocation) => void;
}

type TreeStyles = CSSProperties & Record<`--trees-${string}`, string>;

const TREE_STYLES = {
  height: '100%',
  minHeight: 280,
  '--trees-bg-override': 'var(--bg-secondary)',
  '--trees-bg-muted-override': 'var(--bg-elevated)',
  '--trees-fg-override': 'var(--text-primary)',
  '--trees-fg-muted-override': 'var(--text-muted)',
  '--trees-border-color-override': 'var(--border-color)',
  '--trees-accent-override': 'var(--accent-primary)',
  '--trees-selected-bg-override': 'var(--tab-active)',
  '--trees-selected-fg-override': 'var(--text-primary)',
  '--trees-focus-ring-color-override': 'var(--accent-primary)',
  '--trees-input-bg-override': 'var(--bg-primary)',
  '--trees-search-bg-override': 'var(--bg-primary)',
  '--trees-search-fg-override': 'var(--text-primary)',
  '--trees-font-family-override': 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  '--trees-font-size-override': '12px',
  '--trees-border-radius-override': '8px',
} satisfies TreeStyles;

export function CredentialLocationTree({
  locations,
  selectedFileId,
  onSelect,
}: CredentialLocationTreeProps) {
  const paths = useMemo(() => locations.map(location => location.treePath), [locations]);
  const byPath = useMemo(
    () => new Map(locations.map(location => [location.treePath, location])),
    [locations],
  );
  const onSelectRef = useRef(onSelect);
  const { model } = useFileTree({
    paths,
    initialExpansion: 'open',
    search: true,
    fileTreeSearchMode: 'hide-non-matches',
    density: 'compact',
    icons: 'standard',
  });
  const selectedPaths = useFileTreeSelection(model);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    model.resetPaths(paths);
  }, [model, paths]);

  useEffect(() => {
    const selected = locations.find(location => location.id === selectedFileId);
    if (!selected || model.getSelectedPaths().includes(selected.treePath)) return;
    model.getItem(selected.treePath)?.select();
  }, [locations, model, selectedFileId]);

  useEffect(() => {
    const selectedPath = selectedPaths.at(-1);
    if (!selectedPath) return;
    const location = byPath.get(selectedPath);
    if (location && location.id !== selectedFileId) onSelectRef.current(location);
  }, [byPath, selectedFileId, selectedPaths]);

  return (
    <FileTree
      model={model}
      aria-label="Credential file locations"
      className="block h-full w-full"
      style={TREE_STYLES}
    />
  );
}
