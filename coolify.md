# Coolify deploy — NeoDW

Repo: `afstudy20-gif/neodw-web` (public mirror; tek source = `origin/neodw`).

## Coolify config

| Alan | Değer |
|---|---|
| Application type | **Dockerfile** |
| Repository | `https://github.com/afstudy20-gif/neodw-web` |
| Branch | `main` |
| Build pack | Dockerfile (auto-detect) |
| Dockerfile path | `./Dockerfile` |
| Build context | `/` |
| Port (internal) | `80` |
| Healthcheck path | `/healthz` |
| Healthcheck interval | 30s |

Build ~3-5 dakika (vite + cornerstone WASM bundle ~30MB).

## Custom headers — kritik

Cornerstone WASM çoklu-thread için COOP/COEP zorunlu. `nginx.conf` zaten gönderiyor:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```
Coolify proxy (Traefik) bunları passthrough yapar — ekstra config gerekmez. Sadece **HTTPS zorunlu** (COOP/COEP secure context ister). Coolify Let's Encrypt aç.

## Domain

Örn. `neodw.alanin.com`. Coolify → app → Domains → ekle, "Generate SSL" tıkla.

## Build env vars

Yok. Vite static build, runtime env yok. Tüm config URL query'sinden geliyor.

## Deploy sonrası

```bash
# share.sh artık prod URL'yi kullansın:
cd ~/Documents/projects/remote-dicom
./share.sh <StudyInstanceUID> --ct --viewer https://neodw.alanin.com
```

Veya `NEODW_URL` env var'ı kalıcı tanımla:
```bash
echo 'export NEODW_URL=https://neodw.alanin.com' >> ~/.zshrc
```

## Webhook (otomatik deploy)

Coolify app → Settings → Webhooks → "Auto deploy on push" aç. GitHub'a webhook ekler. Sonra:

```bash
# neodw'de değişiklik commit et:
cd ~/Documents/projects/NeoDW
git push origin main         # private repo
git push neodw-web main      # public mirror → Coolify trigger
```

Tek komuta indirme — `~/.gitconfig`'e:
```
[alias]
  pushall = !git push origin main && git push neodw-web main
```

Veya `origin`'in `pushurl`'ünü çoğalt:
```bash
cd ~/Documents/projects/NeoDW
git remote set-url --add --push origin https://github.com/afstudy20-gif/neodw.git
git remote set-url --add --push origin https://github.com/afstudy20-gif/neodw-web.git
# Artık `git push origin main` ikisine birden gider.
```

## CORS akışı doğrulama

```
arkadaş tarayıcı (Gaziantep)
    │ GET https://neodw.alanin.com/?dicomweb=...&study=...
    ▼
Coolify NeoDW (SPA)  ──XHR──▶  https://xxx.trycloudflare.com/dicom-web/...
                                          │
                                          ▼
                                    senin localhost:8042 Orthanc
                                    (CORS: Access-Control-Allow-Origin: *)
```

İlk açılışta Network tab'da:
- QIDO `/series` 200
- `/metadata` 200 (büyük JSON)
- WADO-RS `/frames/1` çoklu istek (multipart/related; type=image/jls vs)

401 → token yanlış / orthanc.json viewer parolası uyuşmuyor.
404 → StudyInstanceUID yanlış / Orthanc'a yüklenmemiş.
CORS error → orthanc.json `HttpHeaders` bloğu eksik (kontrol et).

## Coolify alternatifi

Coolify yerine `docker run` da olur:
```bash
docker run -d --name neodw -p 8080:80 --restart unless-stopped \
  $(docker build -q https://github.com/afstudy20-gif/neodw-web.git)
```
Ama HTTPS + auto-renew için Coolify (veya Traefik+certbot) gerek.
