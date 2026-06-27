// Thin client for the Orthanc REST API, proxied through this site's
// nginx at /orthanc/. No auth — Orthanc itself has authentication
// disabled; access control lives at the perimeter (deploy domain,
// optional reverse-proxy basic auth).

const ORTHANC = '/orthanc';

export interface StudyDetail {
  id: string;
  patientName: string;
  studyDescription: string;
  studyDate: string;
  studyInstanceUID: string;
  modalities: string[];
  numSeries: number;
  numInstances: number;
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

/** GET /studies → list of internal study IDs. */
export async function listStudyIds(): Promise<string[]> {
  return fetchJson<string[]>('/studies');
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
  };
}

/** Convenience: one round-trip to list every study with detail. */
export async function listStudies(): Promise<StudyDetail[]> {
  const ids = await listStudyIds();
  const details = await Promise.all(ids.map((id) => getStudyDetail(id).catch(() => null)));
  return details.filter((s): s is StudyDetail => s !== null);
}

/** DELETE /studies/{id} — removes every series + instance under the study. */
export async function deleteStudy(id: string): Promise<void> {
  const res = await fetch(`${ORTHANC}/studies/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
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
