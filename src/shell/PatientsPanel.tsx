import { useEffect, useState, useCallback, useRef, type DragEvent } from 'react';
import { listStudies, deleteStudy, uploadInstance, type StudyDetail } from '../shared/orthanc/api';

interface Props {
  /** Called when the user clicks Open on a study. The viewer then mounts
   *  itself in DICOMweb mode against the study UID. */
  onOpenStudy: (study: StudyDetail, modality: 'ct' | 'mr') => void;
}

export function PatientsPanel({ onOpenStudy }: Props) {
  const [studies, setStudies] = useState<StudyDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [uploadState, setUploadState] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const list = await listStudies();
      // Patient name + descending studyDate so newest land on top.
      list.sort((a, b) => (b.studyDate || '').localeCompare(a.studyDate || ''));
      setStudies(list);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStudies([]);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleDelete = useCallback(async (study: StudyDetail) => {
    const label = `${study.patientName} — ${study.studyDescription || study.studyDate}`;
    if (!window.confirm(`"${label}" study'sini silmek istiyor musun?\nBu işlem geri alınamaz.`)) return;
    setBusyIds((prev) => new Set(prev).add(study.id));
    try {
      await deleteStudy(study.id);
      setStudies((prev) => prev?.filter((s) => s.id !== study.id) ?? null);
    } catch (err) {
      window.alert(`Silme başarısız: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(study.id);
        return next;
      });
    }
  }, []);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setUploadState({ done: 0, total: arr.length, failed: 0 });
    let done = 0;
    let failed = 0;
    // Sequential — Orthanc POST /instances is per-file and a single
    // browser tab can saturate the server with concurrent uploads when
    // the wire transfer dominates. Sequential keeps the progress
    // counter honest and is plenty fast for the 100s-of-instance case.
    for (const f of arr) {
      try {
        await uploadInstance(f);
        done += 1;
      } catch {
        failed += 1;
      }
      setUploadState({ done: done + failed, total: arr.length, failed });
    }
    setTimeout(() => setUploadState(null), 2000);
    void refresh();
  }, [refresh]);

  const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) void handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  function preferredModality(mods: string[]): 'ct' | 'mr' {
    if (mods.includes('MR')) return 'mr';
    return 'ct';
  }

  return (
    <div className="patients-panel">
      <div className="patients-head">
        <div className="cap" style={{ fontWeight: 600 }}>
          Server'daki Hastalar {studies != null && <span style={{ opacity: 0.6, fontWeight: 400 }}>· {studies.length}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="open-btn" onClick={() => fileInputRef.current?.click()}>+ Yükle</button>
          <button className="open-btn" onClick={refresh} title="Listeyi yenile">↻</button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".dcm,application/dicom"
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      <div
        className={`upload-zone ${dragOver ? 'drag' : ''}`}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
      >
        {uploadState ? (
          <div>
            <div style={{ marginBottom: 4 }}>
              Yükleniyor — {uploadState.done}/{uploadState.total}{uploadState.failed > 0 && ` (${uploadState.failed} hata)`}
            </div>
            <div className="upload-progress">
              <div className="upload-progress-bar" style={{ width: `${Math.round(100 * uploadState.done / uploadState.total)}%` }} />
            </div>
          </div>
        ) : (
          <div>DICOM klasörünü / dosyalarını buraya sürükle veya <button type="button" className="link-btn" onClick={() => fileInputRef.current?.click()}>seç</button></div>
        )}
      </div>

      {error && (
        <div className="patients-error">
          Liste alınamadı: {error}
        </div>
      )}

      {studies === null && !error && (
        <div className="patients-loading">Yükleniyor…</div>
      )}

      {studies != null && studies.length === 0 && !error && (
        <div className="patients-empty">Henüz hasta yok. Yukarıya DICOM dosyalarını sürükle.</div>
      )}

      {studies != null && studies.length > 0 && (
        <div className="patients-list">
          {studies.map((s) => {
            const busy = busyIds.has(s.id);
            const mod = preferredModality(s.modalities);
            return (
              <div key={s.id} className="patient-row" style={{ opacity: busy ? 0.5 : 1 }}>
                <div className="patient-info">
                  <div className="patient-name">{s.patientName}</div>
                  <div className="patient-meta">
                    {s.studyDate && <span>{formatDate(s.studyDate)}</span>}
                    {s.studyDescription && <span> · {s.studyDescription}</span>}
                    {s.modalities.length > 0 && <span> · {s.modalities.join(', ')}</span>}
                    <span> · {s.numSeries} seri · {s.numInstances} görüntü</span>
                  </div>
                </div>
                <div className="patient-actions">
                  <button
                    className="open-btn primary"
                    disabled={busy}
                    onClick={() => onOpenStudy(s, mod)}
                  >
                    Aç ({mod.toUpperCase()})
                  </button>
                  <button
                    className="open-btn danger"
                    disabled={busy}
                    onClick={() => void handleDelete(s)}
                    title="Bu study'yi sil"
                  >
                    Sil
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatDate(dicom: string): string {
  // DICOM StudyDate is YYYYMMDD. Render as DD/MM/YYYY for tr-TR readers.
  if (!/^\d{8}$/.test(dicom)) return dicom;
  return `${dicom.slice(6, 8)}/${dicom.slice(4, 6)}/${dicom.slice(0, 4)}`;
}
