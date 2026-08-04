# Produkčné nasadenie Geotherm webu

Tento návod popisuje krok za krokom, ako spustiť frontend (React/Vite) a backend (Node.js/Express) v produkcii na vlastnom serveri. Odporúčaný cieľový systém je **Ubuntu 22.04+** s Nginx ako reverse proxy a systemd službou pre API.

## 1. Prerekvizity a infra
- Shell prístup s právami `sudo`.
- Nainštalovaný **Node.js LTS** (napr. cez `curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -` a `sudo apt install nodejs`).
- **Git** na stiahnutie kódu a **Nginx** na proxy + HTTPS (`sudo apt install git nginx`).
- Voliteľne **Certbot** pre Let’s Encrypt (`sudo apt install certbot python3-certbot-nginx`).
- Otvorené porty 80/443 pre web a interný port 4000 pre backend (len z localhostu).

## 2. Klonovanie a adresárová štruktúra
```bash
sudo mkdir -p /srv/geotherm
sudo chown $(whoami):$(whoami) /srv/geotherm
cd /srv/geotherm
git clone https://github.com/KristoveNohy/geotherm-form.git .
```
Adresár `/srv/geotherm` bude obsahovať podsložky `frontend/`, `backend/` a build priečinok `frontend/dist/`.

## 3. Backend – inštalácia a konfigurácia
1. **Závislosti (produkčné):**
   ```bash
   cd /srv/geotherm/backend
   npm ci --omit=dev
   ```
2. **Konfigurácia prostredia:** vytvorte `/srv/geotherm/backend/.env` s hodnotami podľa vášho SMTP a domény:
   ```ini
   PORT=4000
   BACKEND_URL=https://geotherm.kikoland.fun       # URL API pre generovanie liniek k uploadom
   FRONTEND_URL=https://geotherm.kikoland.fun      # povolené CORS/CSP
   TURNSTILE_SECRET_KEY=sem-vlozte-secret-key
   FORM_RATE_LIMIT=3
   FORM_RATE_WINDOW_MS=900000
   UPLOAD_RATE_LIMIT=10
   UPLOAD_RATE_WINDOW_MS=900000
   TRUST_PROXY=true                                # iba ak je backend za jedným Nginx proxy

   SMTP_HOST=smtp.example.com
   SMTP_PORT=587
   SMTP_SECURE=false                               # true pri porte 465
   SMTP_USER=notifikacie@example.com
   SMTP_PASS=super-tajne-heslo
   FROM_EMAIL=Geotherm <notifikacie@example.com>
   FIRM_EMAILS=obchod@geotherm.sk,info@geotherm.sk # CSV zoznam príjemcov

   RETAIN_UPLOADS=false                             # nechajte false, true iba na debug
   ```
   - `BACKEND_URL` sa používa na generovanie URL príloh v e-mailoch.
   - `FRONTEND_URL` musí zodpovedať hostenej SPA, inak CSP blokuje požiadavky.
   - Pri obmedzení CORS nastavte v `server.js` origin len na vašu doménu.
3. **Služba systemd:** vytvorte jednotku `sudo nano /etc/systemd/system/geotherm-api.service`:
   ```ini
   [Unit]
   Description=Geotherm API
   After=network.target

   [Service]
   Type=simple
   WorkingDirectory=/srv/geotherm/backend
   EnvironmentFile=/srv/geotherm/backend/.env
   ExecStart=/usr/bin/node /srv/geotherm/backend/server.js
   Restart=on-failure
   User=www-data
   Group=www-data

   [Install]
   WantedBy=multi-user.target
   ```
   Potom službu načítajte a spustite:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now geotherm-api
   sudo systemctl status geotherm-api
   ```
   Logy zobrazíte cez `journalctl -u geotherm-api -n 100 --no-pager`.

## 4. Frontend – build a konfigurácia
1. **Závislosti a build:**
   ```bash
   cd /srv/geotherm/frontend
   npm ci
   npm run build
   ```
   Build sa uloží do `/srv/geotherm/frontend/dist/`.
2. **Frontend .env:** ak API nie je na `http://localhost:4000`, pridajte súbor `/srv/geotherm/frontend/.env`:
   ```ini
   VITE_API_URL=https://geotherm.kikoland.fun/api
   VITE_TURNSTILE_SITE_KEY=sem-vlozte-sitekey
   ```
   Hodnota musí smerovať na proxy cestu `/api` (viď Nginx konfiguráciu).

## 5. Nginx reverse proxy a HTTPS
1. Vytvorte konfiguráciu `/etc/nginx/sites-available/geotherm` a symlink do `sites-enabled`:
   ```nginx
   server {
       listen 80;
       server_name geotherm.kikoland.fun;
       return 301 https://$host$request_uri;
   }

   server {
       listen 443 ssl http2;
       server_name geotherm.kikoland.fun;

       ssl_certificate     /etc/letsencrypt/live/geotherm.kikoland.fun/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/geotherm.kikoland.fun/privkey.pem;

       root /srv/geotherm/frontend/dist;
       index index.html;

       location / {
           try_files $uri $uri/ /index.html;
       }

       location /api/ {
           proxy_pass http://127.0.0.1:4000/;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           client_max_body_size 30m;
       }
   }
   ```
   Aktivujte a otestujte:
   ```bash
   sudo ln -s /etc/nginx/sites-available/geotherm /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl reload nginx
   ```
2. **HTTPS certifikát:** ak ešte nemáte, spustite `sudo certbot --nginx -d geotherm.kikoland.fun` (automaticky nastaví SSL bloky a obnovu).

## 6. Oprávnenia a úložisko príloh
- Backend ukladá do `backend/uploads/`. Pri použití používateľa `www-data` musí mať práva zápisu:
  ```bash
  sudo chown -R www-data:www-data /srv/geotherm/backend/uploads
  ```
- Nastavenie `RETAIN_UPLOADS=false` zabezpečí automatické zmazanie po odoslaní e-mailov.

## 7. Overenie nasadenia
- Backend: `curl -I http://127.0.0.1:4000/api/form` (očakávaný status 404/405 potvrdí, že port odpovedá).
- Frontend: otvorte `https://geotherm.kikoland.fun` a odošlite testovací formulár s malou prílohou.
- Logy: `journalctl -u geotherm-api -f` počas testu na sledovanie prípadných chýb.

## 8. Aktualizácie a údržba
```bash
cd /srv/geotherm
git pull origin main
cd backend && npm ci --omit=dev && sudo systemctl restart geotherm-api
cd ../frontend && npm ci && npm run build
sudo systemctl reload nginx
```
- Pri zmene `.env` nezabudnite reštartovať službu backendu.
- Odporúčanie: pravidelne kontrolujte obnovenie TLS (`sudo systemctl status certbot.timer`) a logy Nginx (`sudo tail -f /var/log/nginx/access.log`).
