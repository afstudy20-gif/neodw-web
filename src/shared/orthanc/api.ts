// Thin client for the Orthanc REST API, proxied through this site's
// nginx at /orthanc/. No auth — Orthanc itself has authentication
// disabled; access control lives at the perimeter (deploy domain,
// optional reverse-proxy basic auth).

const ORTHANC = '/orthanc';

/** Studies labelled with this tag are hidden from the main list and
 *  surfaced under the "Trash" view. Restore removes the label; Purge
 *  hits the real DELETE. */
export const TRASH_LABEL = 'trash';

export type StudyScope = 'active' | 'trash';

export interface StudyDetail {
  id: string;
  patientName: string;
  studyDescription: string;
  studyDate: string;
  studyInstanceUID: string;
  modalities: string[];
  numSeries: number;
  numInstances: number;
  labels: string[];
}

interface OrthancStudy {
  ID?: string;
  MainDicomTags?: {
    StudyInstanceUID?: string;
    StudyDescription?: string;
    StudyDate?: string;
  };
  PatientMainDicomTags?: { PatientName?: string };
  Series?: string[];
  Labels?: string[];
}

interface OrthancSeries {
  MainDicomTags?: { Modality?: string };
  Instances?: string[];
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${ORTHANC}${path}`, init);
  if (!res.ok) throw new Error(`Orthanc ${res.status} on ${path}`);
  return res.json();
}

/** POST /tools/find scoped to studies. LabelsConstraint controls the
 *  filter: 'All' returns studies that carry every listed label,
 *  'None' returns studies that carry none of them — letting us split
 *  the corpus into active vs trash views without a client-side filter. */
async function findStudyIds(scope: StudyScope): Promise<string[]> {
  const body = {
    Level: 'Study',
    Query: {},
    Expand: false,
    Labels: [TRASH_LABEL],
    LabelsConstraint: scope === 'trash' ? 'All' : 'None',
  };
  const res = await fetch(`${ORTHANC}/tools/find`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`tools/find failed: ${res.status}`);
  return res.json() as Promise<string[]>;
}

/** GET /studies/{id} → enriched detail used by the patient list UI. */
export async function getStudyDetail(id: string): Promise<StudyDetail> {
  const s = await fetchJson<OrthancStudy>(`/studies/${id}`);
  const seriesIds = s.Series || [];
  // Walk one level deeper to surface modalities + instance counts. Sequential
  // to avoid hammering the Orthanc REST API for a list view; the panel
  // memoises results so this only fires per refresh.
  const modalities = new Set<string>();
  let numInstances = 0;
  for (const seriesId of seriesIds) {
    try {
      const se = await fetchJson<OrthancSeries>(`/series/${seriesId}`);
      const mod = se.MainDicomTags?.Modality;
      if (mod) modalities.add(mod);
      numInstances += se.Instances?.length || 0;
    } catch {
      // ignore one bad series — we'd rather show the study with partial info
    }
  }
  return {
    id,
    patientName: s.PatientMainDicomTags?.PatientName || '?',
    studyDescription: s.MainDicomTags?.StudyDescription || '',
    studyDate: s.MainDicomTags?.StudyDate || '',
    studyInstanceUID: s.MainDicomTags?.StudyInstanceUID || '',
    modalities: Array.from(modalities).sort(),
    numSeries: seriesIds.length,
    numInstances,
    labels: s.Labels || [],
  };
}

/** List every study in the given scope ("active" excludes trashed,
 *  "trash" returns only trashed). One round-trip per study to enrich
 *  with series detail. */
export async function listStudies(scope: StudyScope = 'active'): Promise<StudyDetail[]> {
  const ids = await findStudyIds(scope);
  const details = await Promise.all(ids.map((id) => getStudyDetail(id).catch(() => null)));
  return details.filter((s): s is StudyDetail => s !== null);
}

/** Soft-delete: tag the study with the trash label. Reversible via
 *  restoreStudy. The DICOM data stays on disk until purgeStudy runs. */
export async function trashStudy(id: string): Promise<void> {
  const res = await fetch(`${ORTHANC}/studies/${id}/labels/${TRASH_LABEL}`, { method: 'PUT' });
  if (!res.ok) throw new Error(`Trash failed: ${res.status}`);
}

/** Move a study out of the trash by removing its trash label. */
export async function restoreStudy(id: string): Promise<void> {
  const res = await fetch(`${ORTHANC}/studies/${id}/labels/${TRASH_LABEL}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Restore failed: ${res.status}`);
}

/** Permanently delete a study and free its disk space. Irreversible. */
export async function purgeStudy(id: string): Promise<void> {
  const res = await fetch(`${ORTHANC}/studies/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Purge failed: ${res.status}`);
}

/** POST /instances — upload a single DICOM file as raw bytes. */
export async function uploadInstance(file: File | Blob): Promise<{ status: string; id?: string }> {
  const buf = await file.arrayBuffer();
  const res = await fetch(`${ORTHANC}/instances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/dicom' },
    body: buf,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json();
}
