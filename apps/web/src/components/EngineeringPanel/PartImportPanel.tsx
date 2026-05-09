'use client';

import { useState, useRef } from 'react';
import { useWorkspace } from '@/state/store';
import { parseStepFile } from '@/lib/occt';

/**
 * STEP file uploader. Posts the file to the occt-import-js worker, shows
 * a busy state while parsing, then displays derived geometry stats. Errors
 * surface inline (no toast system in the project yet).
 */
export function PartImportPanel() {
  const importedPart = useWorkspace((s) => s.importedPart);
  const setImportedPart = useWorkspace((s) => s.setImportedPart);
  const gatePoint = useWorkspace((s) => s.gatePoint);
  const setGatePoint = useWorkspace((s) => s.setGatePoint);
  const gatePickerActive = useWorkspace((s) => s.gatePickerActive);
  const setGatePickerActive = useWorkspace((s) => s.setGatePickerActive);
  const useGateDrop = useWorkspace((s) => s.useGateDrop);
  const setUseGateDrop = useWorkspace((s) => s.setUseGateDrop);
  const partRotation = useWorkspace((s) => s.partRotation);
  const autoMirrorParts = useWorkspace((s) => s.autoMirrorParts);
  const setAutoMirrorParts = useWorkspace((s) => s.setAutoMirrorParts);
  const partOverlapMarginMm = useWorkspace((s) => s.partOverlapMarginMm);
  const setPartOverlapMarginMm = useWorkspace((s) => s.setPartOverlapMarginMm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const onPick = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const part = await parseStepFile(file);
      setImportedPart(part);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setBusy(false);
      // Reset the file input so re-uploading the same file fires onChange.
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onClear = () => {
    setImportedPart(null);
    setError(null);
  };

  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-bg/40 p-2.5">
      {!importedPart && (
        <>
          <p className="text-[11px] text-muted">
            Upload a <span className="num text-fg">.stp / .step</span> file to replace
            the placeholder cavity boxes with your actual part. Dims, volume and
            projected area auto-derive from the mesh.
          </p>
          <label
            className={
              'flex cursor-pointer items-center justify-center rounded-md border border-info/60 bg-info/15 px-2 py-1.5 text-[11px] font-semibold text-info hover:bg-info/25 ' +
              (busy ? 'pointer-events-none opacity-60' : '')
            }
          >
            <input
              ref={inputRef}
              type="file"
              accept=".stp,.step"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onPick(f);
              }}
            />
            {busy ? 'Parsing…' : 'Upload .stp file'}
          </label>
        </>
      )}
      {importedPart && (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[11px] font-semibold text-fg" title={importedPart.fileName}>
              {importedPart.fileName}
            </span>
            <button
              type="button"
              onClick={onClear}
              className="shrink-0 rounded border border-border bg-bg/60 px-1.5 py-0.5 text-[10px] text-muted hover:text-fg"
            >
              Clear
            </button>
          </div>
          {/* Gate picker — pick a point on the part surface; the drop edge
              re-targets to land there for every cavity. */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setGatePickerActive(!gatePickerActive)}
              className={
                'flex-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ' +
                (gatePickerActive
                  ? 'border-warn/60 bg-warn/15 text-warn hover:bg-warn/25'
                  : 'border-accent/60 bg-accent/15 text-accent hover:bg-accent/25')
              }
              title="Click anywhere on the part surface in the 3D view to set the gate."
            >
              {gatePickerActive ? 'Cancel pick' : (gatePoint ? 'Re-pick gate' : 'Pick gate')}
            </button>
            {gatePoint && !gatePickerActive && (
              <button
                type="button"
                onClick={() => setGatePoint(null)}
                className="shrink-0 rounded border border-border bg-bg/60 px-2 py-1 text-[10px] text-muted hover:text-fg"
                title="Revert to the default top-centre-of-AABB gate."
              >
                Clear gate
              </button>
            )}
          </div>
          {gatePoint && (
            <p className="text-[10px] text-muted">
              Gate at part-local{' '}
              <span className="num text-fg">
                ({gatePoint[0].toFixed(1)}, {gatePoint[1].toFixed(1)}, {gatePoint[2].toFixed(1)})
              </span>{' '}
              mm.
            </p>
          )}

          {/* Quick drop toggle — the orientation wizard is in the gate
              picker modal where the user can see the rotation take effect
              against the live mesh. */}
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border/60 bg-bg/40 px-2 py-1.5 text-[11px]">
            <input
              type="checkbox"
              className="h-3 w-3 accent-accent"
              checked={useGateDrop}
              onChange={(e) => setUseGateDrop(e.target.checked)}
            />
            <span className="text-fg">Use vertical gate drop</span>
            <span className="ml-auto text-[10px] text-muted">
              {useGateDrop ? '55 mm tube' : 'no drop'}
            </span>
          </label>
          {(partRotation.x !== 0 || partRotation.y !== 0 || partRotation.z !== 0) && (
            <p className="text-[10px] text-muted/80">
              Part orientation: <span className="num text-fg">
                X {Math.round(partRotation.x)}° / Y {Math.round(partRotation.y)}° / Z {Math.round(partRotation.z)}°
              </span>{' '}
              <span className="text-muted">— set in Pick gate window.</span>
            </p>
          )}

          {/* Auto-mirror: parts on the −X side flip 180° around their gate
              point so the gate side faces inward toward the runner. */}
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border/60 bg-bg/40 px-2 py-1.5 text-[11px]">
            <input
              type="checkbox"
              className="h-3 w-3 accent-accent"
              checked={autoMirrorParts}
              onChange={(e) => setAutoMirrorParts(e.target.checked)}
            />
            <span className="text-fg">Auto-mirror −X cavities</span>
            <span className="ml-auto text-[10px] text-muted">
              {autoMirrorParts ? 'gate faces sprue' : 'all same orientation'}
            </span>
          </label>

          {/* Layout auto-spacing: enforces a minimum cavity-to-cavity
              clearance based on part size + this margin. The pipeline
              scales the entire layout uniformly until the rule holds. */}
          <div className="flex items-center gap-2 rounded-md border border-border/60 bg-bg/40 px-2 py-1.5 text-[11px]">
            <span className="text-fg" title="Minimum mm of clearance between cavity edges. Pipeline scales the layout up uniformly if the natural spacing is tighter.">
              Cavity clearance
            </span>
            <input
              type="number"
              className="num ml-auto w-16 rounded-md border border-border bg-bg px-1.5 py-1 text-right text-[11px] text-fg"
              value={partOverlapMarginMm}
              min={0}
              step={5}
              onChange={(e) => setPartOverlapMarginMm(parseFloat(e.target.value) || 0)}
            />
            <span className="text-[10px] text-muted">mm</span>
          </div>
          <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
            <dt className="text-muted">W × D × H</dt>
            <dd className="num text-right text-fg">
              {importedPart.geometry.dimsMm.w.toFixed(1)} × {importedPart.geometry.dimsMm.d.toFixed(1)} × {importedPart.geometry.dimsMm.h.toFixed(1)} mm
            </dd>
            <dt className="text-muted">Volume</dt>
            <dd className="num text-right text-fg">
              {importedPart.geometry.volumeMm3.toFixed(0)} mm³
            </dd>
            <dt className="text-muted">Projected area</dt>
            <dd className="num text-right text-fg">
              {importedPart.geometry.projectedAreaMm2.toFixed(0)} mm²
            </dd>
            <dt className="text-muted">
              Wall thickness
              <span className="ml-1 text-muted/70">(BVH raycast)</span>
            </dt>
            <dd className="num text-right text-fg">
              {importedPart.geometry.wallThicknessMm.median.toFixed(2)} mm
            </dd>
            <dt className="text-muted/70 pl-2">— min / max</dt>
            <dd className="num text-right text-muted/70">
              {importedPart.geometry.wallThicknessMm.min.toFixed(2)} / {importedPart.geometry.wallThicknessMm.max.toFixed(2)} mm
            </dd>
            <dt className="text-muted">Triangles</dt>
            <dd className="num text-right text-fg">
              {importedPart.geometry.triangleCount.toLocaleString()}
            </dd>
          </dl>
        </>
      )}
      {error && (
        <p className="text-[10px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
