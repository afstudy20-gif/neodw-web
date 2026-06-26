# remote-dicom

Bilgisayarında lokal **Orthanc** (DICOMweb sunucusu) + **cloudflared** quick tunnel.
Arkadaşın NeoDW üzerinden tek tıkla CT/MR study'yi açar; DICOM dosyaları senin makinende kalır.

```
arkadaş tarayıcı  ──https──▶  cloudflared edge  ──https──▶  senin localhost:8042 (Orthanc)
                                                                       │
                                                            NeoDW (vite dev) ──fetch──┘
```

## Kurulum (tek seferlik)

1. **Parolaları değiştir** — `orthanc.json` ve `upload.sh` / `share.sh` içindeki `CHANGE_ME_VIEWER_PASS` ve `CHANGE_ME_ADMIN_PASS` placeholder'larını gerçek parolalarla değiştir. Aynı string'i 4 dosyada da kullan.

   ```bash
   # macOS sed:
   VPASS='gercek-viewer-parolan'
   APASS='gercek-admin-parolan'
   sed -i '' "s/CHANGE_ME_VIEWER_PASS/$VPASS/g" orthanc.json tunnel.sh share.sh
   sed -i '' "s/CHANGE_ME_ADMIN_PASS/$APASS/g" orthanc.json upload.sh share.sh
   ```

2. **Setup'ı çalıştır** — Docker'ı başlatır, cloudflared'i kurar, Orthanc'ı ayağa kaldırır.

   ```bash
   ./setup.sh
   ```

   Sonunda `http://127.0.0.1:8042` açılır. Tarayıcıda `viewer` veya `admin` ile giriş yap.

## Her seansta

```bash
# 1) DICOM'ları yükle (klasör veya zip):
./upload.sh ~/Documents/hasta-X-ct-mr/

# Studies listesi basılır. Göstermek istediğin StudyInstanceUID'i kopyala.

# 2) Tunnel'ı aç:
./tunnel.sh
# → "Tunnel live: https://xxxxx.trycloudflare.com"

# 3) Share URL üret:
./share.sh 1.2.840.113619.2.55.3.123456789.0.0.1234 --ct \
  --viewer http://localhost:5173

# → arkadaşa yollanacak link basılır
```

## NeoDW client tarafı

NeoDW'ye eklenen DICOMweb yolu:

- `?dicomweb=<URL>&study=<UID>&modality=ct|mr` query
- `#token=<base64(viewer:pass)>` fragment (sunucuya gitmez)

`src/App.tsx` ve `src/shared/dicom/dicomwebLoader.ts` yeni yolu yönetiyor. Welcome ekranı atlanır, CT viewer doğrudan açılır. CT modülü hem CT hem MR volume'larını işliyor (her ikisi de cornerstone streaming volume).

### Production URL kullanımı

Localhost yerine deploy edilmiş NeoDW (örn. Netlify/Vercel build) kullanmak istersen `share.sh --viewer https://neodw.example.com` ile o domain'i ver. CORS açık olduğundan tarayıcı arkadaşının makinesinden cloudflared URL'sine direkt erişir.

## Güvenlik notları

- Token (Basic Auth) URL fragment'inde (`#token=...`) tutuluyor — fragment HTTP isteğine konmaz, sunucu loglarına düşmez.
- `viewer` parolası salt okuma. `admin` upload + silme yetkisi taşıyor. Share link sadece `viewer`'ı taşır.
- Quick tunnel URL'leri ephemeral — `tunnel.sh` her çalıştığında yeni hostname. Kalıcı URL için Cloudflare Zero Trust + named tunnel kullanılabilir.
- Bilgisayar kapanırsa link çalışmaz. Bunu yaymak istersen `orthanc.json` + docker-compose VPS'e taşı (Hetzner CX11 ~€4/ay).

## Sorun giderme

| Belirti | Çözüm |
|---|---|
| `Docker did not start` | Docker Desktop'ı manuel aç, `./setup.sh` tekrar |
| `cloudflared not installed` | `brew install cloudflared` |
| Share URL açılınca "DICOMweb 401" | Token yanlış / orthanc.json viewer parolası `share.sh` ile uyuşmuyor |
| "No CT/MR series found" | Upload başka modalite (US/echo) yüklemiş — Orthanc Explorer'da kontrol et |
| Yavaş yüklenme | Cloudflare quick tunnel ~10 MB/s tavanı. Big studies için VPS Orthanc + native CDN daha hızlı |

## Dosyalar

- `docker-compose.yml` — Orthanc + DICOMweb plugin
- `orthanc.json` — config (CORS açık, auth zorunlu, DICOMweb root `/dicom-web/`)
- `setup.sh` — Docker + cloudflared + Orthanc bring-up (idempotent)
- `upload.sh` — DICOM klasör/zip → Orthanc POST
- `tunnel.sh` — cloudflared quick tunnel başlat, URL'i `tunnel-url.txt`'e yaz
- `share.sh` — share URL üret (token + study + viewer base)
