# Penilaian keselamatan aplikasi

Tarikh semakan: 2026-10-13

Skop: semakan kod aplikasi, konfigurasi deployment, ujian workspace, audit pakej produksi dan build imej Docker.

## Keputusan

Hardening kod telah dibuat dengan sasaran OWASP ASVS Level 2. Ini ialah semakan dalaman berasaskan kod dan ujian, bukan pensijilan ASVS atau ujian penembusan. Baki di bahagian **Belum selesai** menghalang dakwaan bahawa sistem sudah mencapai tahap keselamatan tertinggi.

Rujukan: [OWASP ASVS](https://owasp.org/projects/asvs), [OWASP Top 10:2025](https://top10.owasp.org/2025/0x00_2025-Introduction/).

## Kawalan yang ditambah atau diperketat

| Domain OWASP 2025 | Kawalan dan bukti dalam repositori |
| --- | --- |
| A01 Broken Access Control | Pemeriksaan peranan dan skop tenant, polisi PostgreSQL RLS, pengikatan akaun Entra melalui `tid` + `oid`, dan reset MFA oleh superadmin untuk akaun lain dengan sebab serta audit. |
| A02 Security Misconfiguration | CORS production menggunakan origin admin yang ditetapkan, HSTS pada laluan Caddy/Nginx yang dikonfigurasi, header keselamatan admin, host/proxy validation, port aplikasi Docker pada rangkaian dalaman, API/frontend berjalan sebagai user bukan root, Nginx admin unprivileged pada port 8080, dan CSP monitor dengan nonce unik. |
| A03 Software Supply Chain Failures | Audit production dependency dalam CI; Dockerfile menjalankan ujian aplikasi ketika build; input versi pnpm daripada registry divalidasi sebelum masuk ke skrip deployment. |
| A04 Cryptographic Failures | Sesi menggunakan cookie `HttpOnly`, `Secure` dalam production dan perlindungan CSRF; secret sesi dan setup mesti sekurang-kurangnya 32 bait; hash kata laluan menggunakan scrypt dengan kos memori tinggi dan migrasi hash lama selepas log masuk sah. |
| A05 Injection | HTML tersuai dibersihkan, CSP dipasang, jenis fail muat naik dibandingkan dengan tandatangan kandungan, dan input host/path disekat pada laluan sensitif. |
| A06 Insecure Design | MFA wajib untuk akaun password di production; superadmin sentiasa wajib MFA; rate limit log masuk dan proses bootstrap pertama; pemulihan MFA memerlukan pelaku kedua dan direkodkan. |
| A07 Authentication Failures | MFA TOTP, pengesahan password/MFA berperingkat, had 8 kegagalan Basic Auth monitor per IP dalam tetingkap 10 minit dengan sekatan 15 minit, invalidasi sesi apabila bukti kelayakan berubah, serta semakan signature, issuer, audience, nonce, masa, tenant dan object ID untuk Entra. |
| A08 Software or Data Integrity Failures | Restore sandaran mengesahkan manifest sebelum mutasi, had bilangan fail arkib, dan perubahan rekod tenant dibuat secara transaksi. |
| A09 Security Logging & Alerting Failures | Perubahan pengguna, pautan Entra, reset MFA dan destinasi sandaran menghasilkan peristiwa audit. |
| A10 Mishandling of Exceptional Conditions | Production gagal boot jika secret wajib tiada; kegagalan restore pangkalan data rollback secara atomik; respons muat naik menolak kandungan yang tidak sepadan dengan MIME. |

## Belum selesai — keutamaan tinggi

1. **Migrasi production ke SCRAM perlu dilaksanakan dan disahkan.** Pemasangan baharu menetapkan SCRAM; `scripts/configure-docker-db-roles.sh` menukar verifier role postgres/app/provisioner lama sekali sahaja, memasang verifier PostgreSQL yang sama untuk PgBouncer, kemudian reload pooler. Susunan deploy dikemas kini supaya DB dimigrasi sebelum PgBouncer direcreate. Perubahan ini belum dijalankan pada production. Sahkan health check PgBouncer dan login API selepas deployment. PostgreSQL mengesyorkan SCRAM dan menandakan MD5 deprecated. Rujuk [PostgreSQL password authentication](https://www.postgresql.org/docs/16/auth-password.html) dan [PgBouncer authentication](https://www.pgbouncer.org/config.html).

   Log redeploy pada 2026-10-13 menunjukkan `server login failed: wrong password type` melalui PgBouncer `1.25.2`. Imej dinaik taraf kepada `1.26.0-1` kerana nota keluaran upstream membaiki regresi pass-through SCRAM selepas sambungan semula. Deploy kini memeriksa login sebenar sebelum membina warna baharu; pengesahan pada VPS masih diperlukan.

2. **Sulitkan rahsia yang disimpan dalam pangkalan data dan sandaran.** `users.totp_secret`, `platform_settings.backup_destination` (contohnya S3 secret dan service-account JSON) serta `platform_settings.media_storage` mengandungi rahsia dalam bentuk boleh dibaca. Reka bentuk pembaikan perlu menggunakan key berasingan yang disimpan di luar DB, merangkumi API, monitor dan cron backup, menyediakan migrasi plaintext lama, key rotation, serta pemulihan backup apabila key tersedia. Jangan hilangkan akses key semasa migrasi.

3. **Had memori restore ZIP.** Restore kini dihadkan kepada 64 MiB arkib dan 128 MiB data nyahmampat kerana container API lalai 512 MiB. Ini menutup laluan penggunaan memori tanpa had besar; arkib melebihi had perlu dipindahkan melalui proses filesystem/DB yang sesuai. Kerja susulan ialah membina restore streaming dan ujian pemulihan backup besar.

4. **Pengesahan operasi production.** Build imej tidak menguji laluan sebenar `/api/pages?slug=home` terhadap tenant dan pangkalan data deployment. Selepas deploy berjadual, jalankan smoke test halaman sebenar, sahkan Entra `amr` MFA serta pautan `oid` untuk setiap pengguna, kemudian uji backup/restore dan pemulihan rollback.

## Belum selesai — pengukuhan seterusnya

- Monitor kini menggunakan nonce unik bagi skrip dashboard dan menghadkan 8 kegagalan Basic Auth bagi setiap alamat sambungan dalam 10 minit, kemudian menyekatnya selama 15 minit. `style-src 'unsafe-inline'` masih diperlukan oleh gaya inline; langkah seterusnya ialah pindahkan gaya itu ke kelas CSS atau hash.
- Akses monitor kini boleh ditukar melalui `scripts/monitor-access.sh`: `public` hanya melalui HTTPS Caddy, `ssh` menolak Host awam, dan `cloud` mengekalkan origin peribadi untuk tunnel dengan dasar identiti/MFA di edge. Mod `public` sesuai sementara pembangunan sahaja kerana Basic Auth monitor belum menyediakan MFA sendiri; mod `cloud` dengan akses identiti atau `ssh` disyorkan untuk operasi jangka panjang.
- Pengesahan OIDC Entra masih dilaksanakan sendiri. Kekalkan ujian signature/JWKS dan semakan claim; rancang migrasi kepada klien OIDC terpelihara supaya perubahan protokol dan rotation kunci ditangani oleh pustaka khusus. Microsoft menyatakan `email` dan `preferred_username` boleh berubah; gunakan `tid` + `oid`, serta padankan nonce. Rujuk [ID token claims](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference) dan [claims validation](https://learn.microsoft.com/en-us/entra/identity-platform/claims-validation).
- Imej asas masih menggunakan tag versi, bukan digest; pipeline belum menghasilkan SBOM atau mengesahkan tandatangan imej. Tambah pengimbasan OS image, SBOM, provenance dan dasar promosi imej sebelum release.
- Sandaran off-site boleh mengandungi salinan DB/media. Aktifkan encryption pada destinasi sandaran dan buat ujian pemulihan berkala, termasuk perlindungan key yang berasingan daripada fail backup.
- Lengkapkan DAST dan ujian tenant-isolation menggunakan akaun berlainan, semakan manual semua route sensitif, serta pentest bebas sebelum menyatakan pematuhan ASVS.

## Bukti ujian semasa

- `pnpm -r test`: **423 lulus, 0 gagal**.
- `pnpm typecheck`: semua workspace lulus; satu hint Astro sedia ada.
- `pnpm build`: semua workspace lulus; admin mengeluarkan amaran saiz chunk.
- `pnpm audit --prod`: **0 advisory**, 636 dependencies dalam graph audit.
- `docker compose config --quiet`: konfigurasi production dan trial lulus dengan nilai env sementara.
- `docker compose build api frontend admin`: ketiga-tiga imej berjaya dibina.
- Imej admin berjalan tanpa rangkaian/port, root filesystem read-only, sebagai UID 101; HTTP 200 dan header CSP, `nosniff`, anti-frame serta referrer policy disahkan.
- Stack sementara PostgreSQL 16/PgBouncer menguji migrasi verifier MD5 ke SCRAM dan login berjaya apabila HBA sedia ada masih `md5` (PostgreSQL memilih SCRAM bagi verifier SCRAM).
- Imej admin lulus `nginx -t`; entrypoint API dan frontend lulus `node --check`; API/frontend berjalan sebagai user `app`.
- Container tidak dimulakan semula dan trafik production tidak ditukar dalam semakan ini. Docker build bukan pengganti smoke test aplikasi hidup.
