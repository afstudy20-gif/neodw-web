import { useEffect, useState, useCallback, useRef, type DragEvent } from 'react';
import {
  listStudies, trashStudy, restoreStudy, purgeStudy, uploadInstance,
  type StudyDetail, type StudyScope,
} from '../shared/orthanc/api';

interface Props {
  /** Called when the user clicks Open on a study. The viewer then mounts
   *  itself in DICOMweb mode against the study UID. */
  onOpenStudy: (study: StudyDetail, modality: 'ct' | 'mr') => void;
}

export function PatientsPanel({ onOpenStudy }: Props) {
  const [scope, setScope] = useState<StudyScope>('active');
  const [studies, setStudies] = useState<StudyDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [uploadState, setUploadState] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setError(null);
    setStudies(null);
    try {
      const list = await listStudies(scope);
      // Patient name + descending studyDate so newest land on top.
      list.sort((a, b) => (b.studyDate || '').localeCompare(a.studyDate || ''));
      setStudies(list);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStudies([]);
    }
  }, [scope]);

  useEffect(() => { void refresh(); }, [refresh]);

  const withBusy = useCallback(async (id: string, op: () => Promise<void>) => {
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      await op();
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const handleTrash = useCallback(async (study: StudyDetail) => {
    const label = `${study.patientName} — ${study.studyDescription || study.studyDate}`;
    if (!window.confirm(`"${label}" study'sini Çöp'e taşı?\nGeri Al ile geri getirebilirsin.`)) return;
    await withBusy(study.id, async () => {
      try {
        await trashStudy(study.id);
        setStudies((prev) => prev?.filter((s) => s.id !== study.id) ?? null);
      } catch (err) {
        window.alert(`Çöpe taşıma başarısız: ${err instanceof Error ? err.message : err}`);
      }
    });
  }, [withBusy]);

  const handleRestore = useCallback(async (study: StudyDetail) => {
    await withBusy(study.id, async () => {
      try {
        await restoreStudy(study.id);
        setStudies((prev) => prev?.filter((s) => s.id !== study.id) ?? null);
      } catch (err) {
        window.alert(`Geri alma başarısız: ${err instanceof Error ? err.message : err}`);
      }
    });
  }, [withBusy]);

  const handlePurge = useCallback(async (study: StudyDetail) => {
    const label = `${study.patientName} — ${study.studyDescription || study.studyDate}`;
    if (!window.confirm(`"${label}" KALICI olarak silinecek.\nBu işlem geri alınamaz. Emin misin?`)) return;
    await withBusy(study.id, async () => {
      try {
        await purgeStudy(study.id);
        setStudies((prev) => prev?.filter((s) => s.id !== study.id) ?? null);
      } catch (err) {
        window.alert(`Kalıcı silme başarısız: ${err instanceof Error ? err.message : err}`);
      }
    });
  }, [withBusy]);

  const handleEmptyTrash = useCallback(async () => {
    if (!studies || studies.length === 0) return;
    if (!window.confirm(`Çöp'teki ${studies.length} study KALICI olarak silinecek.\nBu işlem geri alınamaz. Emin misin?`)) return;
    for (const s of studies) {
      try { await purgeStudy(s.id); } catch { /* keep going */ }
    }
    void refresh();
  }, [studies, refresh]);

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

  const isTrash = scope === 'trash';

  return (
    <div className="patients-panel">
      <div className="patients-tabs">
        <button
          className={`patients-tab ${!isTrash ? 'active' : ''}`}
          onClick={() => setScope('active')}
        >
          Hastalar
        </button>
        <button
          className={`patients-tab ${isTrash ? 'active' : ''}`}
          onClick={() => setScope('trash')}
        >
          Çöp
        </button>
        <div style={{ flex: 1 }} />
        {!isTrash && (
          <button className="open-btn" onClick={() => fileInputRef.current?.click()}>+ Yükle</button>
        )}
        {isTrash && studies && studies.length > 0 && (
          <button className="open-btn danger" onClick={handleEmptyTrash} title="Çöp'teki her şeyi kalıcı sil">
            Çöp'ü Boşalt
          </button>
        )}
        <button className="open-btn" onClick={refresh} title="Listeyi yenile">↻</button>
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

      {!isTrash && (
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
      )}

      {error && (
        <div className="patients-error">
          Liste alınamadı: {error}
        </div>
      )}

      {studies === null && !error && (
        <div className="patients-loading">Yükleniyor…</div>
      )}

      {studies != null && studies.length === 0 && !error && (
        <div className="patients-empty">
          {isTrash ? 'Çöp boş.' : 'Henüz hasta yok. Yukarıya DICOM dosyalarını sürükle.'}
        </div>
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
                  {!isTrash ? (
                    <>
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
                        onClick={() => void handleTrash(s)}
                        title="Bu study'yi Çöp'e taşı"
                      >
                        Sil
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="open-btn"
                        disabled={busy}
                        onClick={() => void handleRestore(s)}
                        title="Çöp'ten geri al"
                      >
                        Geri Al
                      </button>
                      <button
                        className="open-btn danger"
                        disabled={busy}
                        onClick={() => void handlePurge(s)}
                        title="Kalıcı olarak sil"
                      >
                        Kalıcı Sil
                      </button>
                    </>
                  )}
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
