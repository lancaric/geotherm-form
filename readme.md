Geotherm – online formulár pre dopyty
=====================================

Komplexný systém pre odosielanie zákazníckych dopytov vrátane viacnásobných príloh, emailových notifikácií a pokročilej validácie.

Projekt pozostáva z:

*   **frontend** – SPA aplikácia v React/Vite
    
*   **backend API** – Node.js/Express server s emailovou logikou a správou príloh
    

Produkčná testovacia verzia beží na adrese:  
`https://geotherm.kikoland.fun`

> Tento projekt je pripravený na presun na finálnu doménu Geotherm Slovakia s.r.o.

* * *

📌 Obsah
--------

*   Architektúra projektu
    
*   Funkcionalita z pohľadu používateľa
    
*   Použité technológie
    
*   Štruktúra priečinkov
    
*   Inštalácia – vývojové prostredie
    
*   Environment variables
    
*   Spustenie vo vývoji
    
*   Build a produkčné nasadenie
    
*   Nginx reverse proxy & SSL
    
*   Pipeline pre upload súborov
    
*   Email notifikácie – workflow
    
*   Bezpečnostné odporúčania
    
*   Údržba a rozšírenia
    

* * *

🏗 Architektúra projektu
------------------------

### Frontend

*   React + TypeScript (Vite)
    
*   TailwindCSS pre dizajn a layout
    
*   Single-page aplikácia (SPA)
    
*   Pokročilý formulár s:
    
    *   validáciou počas písania (meno, email, telefón, povinné polia)
        
    *   rozlíšením **Novostavba / Rekonštrukcia**
        
    *   doplnkovými nepovinnými sekciami (technické detaily stavby)
        
    *   nahrávaním viacerých príloh
        
    *   fullscreen overlayom (stav odosielania)
        

### Backend

*   Node.js (Express)
    
*   REST API endpointy (príklad):
    
    *   `POST /api/upload` – upload jednej prílohy
        
    *   `DELETE /api/upload/:id` – zmazanie nahratej prílohy
        
    *   `POST /api/form` (resp. podľa aktuálnej implementácie `/api/submit`) – spracovanie formulára a emailov
        
*   Ukladanie príloh na disk do `backend/uploads`
    
*   Odosielanie emailov cez SMTP (Gmail – App Password)
    
*   Automatické zmazanie príloh po spracovaní (úspech aj chyba)
    

### Nasadenie

*   **Ubuntu server** (self-hosted VPS/domáci server)
    
*   **Nginx** ako reverse proxy pred frontendom + backendom
    
*   **systemd** služba pre backend (`geotherm-api.service`)
    
*   **Let’s Encrypt / Certbot** – HTTPS certifikáty
    

* * *

👀 Funkcionalita z pohľadu používateľa
--------------------------------------

1.  Používateľ otvorí formulár (desktop / mobil).
    
2.  Vyplní základné údaje (meno, email, telefón, typ stavby, správa).
    
3.  Voliteľne vyplní doplnkové technické údaje (Novostavba/Rekonštrukcia).
    
4.  Pridá prílohy (projekt, pôdorysy, technické správy):
    
    *   povolené typy: `.pdf`, `.doc`, `.docx`, `.jpg`, `.jpeg`, `.png`
        
    *   1 súbor max **5 MB**
        
    *   všetky súbory spolu max **20 MB**
        
5.  Po výbere sa prílohy **automaticky nahrávajú** na server:
    
    *   vidno priebeh (progress bar)
        
    *   možnosť zrušiť/odstrániť prílohu
        
6.  Tlačidlo „Odoslať“ je dostupné až keď sú všetky prílohy úspešne nahrané.
    
7.  Po kliknutí na „Odoslať“:
    
    *   zobrazí sa **fullscreen overlay**:
        
        *   stav _„Odosielam žiadosť…“_
            
        *   používateľ **nemusí zostať na stránke** – spracovanie prebieha na pozadí.
            
8.  Backend spracuje formulár:
    
    *   najprv odošle email firme
        
    *   až potom (po úspechu) odošle potvrdenie zákazníkovi
        
    *   v prípade chyby odošle zákazníkovi správu o chybe
        
9.  **Prílohy sa po odoslaní vždy zmažú** z disku (bez ohľadu na úspech/neúspech).
    

* * *

🧩 Použité technológie
----------------------

**Frontend:**

*   React 18+
    
*   TypeScript
    
*   Vite
    
*   TailwindCSS
    

**Backend:**

*   Node.js (LTS)
    
*   Express
    
*   Nodemailer (SMTP)
    
*   Node FS (práca so súbormi)
    

**Infra:**

*   Ubuntu Server
    
*   Nginx
    
*   systemd
    
*   Let’s Encrypt (Certbot)
    

* * *

📁 Štruktúra priečinkov
-----------------------

Približná štruktúra na serveri:

bash

Kopírovať kód

`/srv/geotherm ├── backend │   ├── server.js │   ├── uploads/           # dočasne nahraté prílohy │   ├── package.json │   └── .env │ ├── frontend │   ├── src/ │   │   └── components/QuoteForm.tsx │   ├── dist/              # build pre produkciu (vite build) │   ├── package.json │   └── .env │ └── README.md`

* * *

🛠 Inštalácia – vývojové prostredie
-----------------------------------

### 1) Klonovanie repozitára

bash

Kopírovať kód

`git clone git@github.com:<USERNAME>/<REPO>.git geotherm-form cd geotherm-form`

### 2) Inštalácia závislostí

**Frontend:**

bash

Kopírovať kód

`cd frontend npm install`

**Backend:**

bash

Kopírovať kód

`cd backend npm install`

* * *

🔧 Environment variables
------------------------

### Frontend – `frontend/.env`

Vo vývoji (lokálne):

env

Kopírovať kód

`VITE_API_URL=http://localhost:4000/api`

V produkcii (na serveri):

env

Kopírovať kód

`VITE_API_URL=https://geotherm.kikoland.fun/api`

> `VITE_API_URL` ukazuje na **root backend API** (Nginx proxy), na ktorú frontend pridáva `/upload`, `/form`, atď.

* * *

### Backend – `backend/.env`

Príklad konfigurácie:

env

Kopírovať kód

`PORT=4000  # URL frontendu (pre CORS a odkazy v emailoch) FRONTEND_URL=https://geotherm.kikoland.fun  # URL backendu (ak sa používa v emailových template-och) BACKEND_URL=https://geotherm.kikoland.fun/api  # SMTP – odporúčaný vlastný SMTP provider (dočasne Gmail App Password) SMTP_HOST=smtp.gmail.com SMTP_PORT=587 SMTP_SECURE=false SMTP_USER=xxxxx@gmail.com SMTP_PASS=SMTP_APP_PASSWORD  FROM_EMAIL="Geotherm <no-reply@geotherm.sk>"  # Kam sa posielajú dopyty vo firme (CSV zoznam) FIRM_EMAILS="spacinsky@geotherm.sk, niekto.dalsi@geotherm.sk"`

> **Pozor:** Gmail App Password nepatrí do verejného repa. `.env` musí byť v `.gitignore`.

* * *

▶️ Spustenie vo vývoji
----------------------

### Backend (lokálne)

bash

Kopírovať kód

`cd backend npm install node server.js # alebo: nodemon server.js (ak používaš nodemon)`

Backend beží na `http://localhost:4000`.

### Frontend (lokálne)

bash

Kopírovať kód

`cd frontend npm install npm run dev`

Frontend beží na `http://localhost:5173`.

V tomto režime musí byť vo FE `.env`:

env

Kopírovať kód

`VITE_API_URL=http://localhost:4000/api`

* * *

📦 Build a produkčné nasadenie
------------------------------

### Frontend – build

Na serveri:

bash

Kopírovať kód

`cd /srv/geotherm/frontend npm install        # pri prvom nasadení npm run build      # vytvorí ./dist`

Výstup `dist/` slúži ako static root pre Nginx.

### Backend – systemd služba

Súbor: `/etc/systemd/system/geotherm-api.service`

ini

Kopírovať kód

`[Unit] Description=Geotherm API After=network.target  [Service] WorkingDirectory=/srv/geotherm/backend ExecStart=/usr/bin/node /srv/geotherm/backend/server.js Restart=always Environment=NODE_ENV=production StandardOutput=journal StandardError=journal User=kristian Group=kristian  [Install] WantedBy=multi-user.target`

Aktivácia:

bash

Kopírovať kód

`sudo systemctl daemon-reload sudo systemctl enable geotherm-api sudo systemctl start geotherm-api sudo systemctl status geotherm-api --no-pager`

* * *

🌐 Nginx reverse proxy & SSL
----------------------------

Doména (testovacia):  
`geotherm.kikoland.fun`

### HTTP → HTTPS redirect

nginx

Kopírovať kód

`server {     listen 80;     listen [::]:80;     server_name geotherm.kikoland.fun;      return 301 https://geotherm.kikoland.fun$request_uri; }`

### HTTPS server block

nginx

Kopírovať kód

`server {     listen 443 ssl http2;     listen [::]:443 ssl http2;     server_name geotherm.kikoland.fun;      ssl_certificate     /etc/letsencrypt/live/geotherm.kikoland.fun/fullchain.pem;     ssl_certificate_key /etc/letsencrypt/live/geotherm.kikoland.fun/privkey.pem;      # Frontend build     root /srv/geotherm/frontend/dist;     index index.html;      # SPA routing     location / {         try_files $uri $uri/ /index.html;     }      # API proxy na backend     location /api/ {         proxy_pass http://127.0.0.1:4000/;         proxy_http_version 1.1;         proxy_set_header Host              $host;         proxy_set_header X-Real-IP         $remote_addr;         proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;         proxy_set_header X-Forwarded-Proto $scheme;         client_max_body_size 30m;          # limit veľkosti requestu (upload)     } }`

Po úprave:

bash

Kopírovať kód

`sudo nginx -t sudo systemctl reload nginx`

* * *

📤 Pipeline pre upload súborov
------------------------------

### 1) Frontend

*   používateľ vyberie súbor(y)
    
*   okamžite sa spúšťa **upload na backend** (`POST /api/upload`)
    
*   počas nahrávania:
    
    *   progress bar (0–100 %)
        
    *   možnosť zrušiť upload (abort)
        
*   po úspešnom uploade:
    
    *   súbor je označený ako „Nahrané“
        
    *   do lokálneho state sa uloží ID/meno súboru (pre neskoršie poslanie v payload-e formulára)
        
*   tlačidlo „Odoslať formulár“ je aktívne **až keď sú všetky prílohy v stave DONE**
    

### 2) Backend – `/api/upload`

*   prijme jeden súbor vo ``For(`field: file`)``
    
`` *   uloží súbor do `backend/uploads/`      *   vráti JSON:          json          Kopírovať kód          `{   "id": "internal-file-id-or-name",   "url": "/internal/path/or/null" }` ``

``   ### 3) Mazanie súborov  *   pred odoslaním formulára:          *   FE posiela backendu len meta-info (ID nahratých súborov)          *   po spracovaní formulára a emailov:          *   backend prechádza všetky použité súbory a maže ich z `uploads/`              *   rovnako maže súbory aj pri chybovom stave (cleanup)           * * *  📧 Email notifikácie – workflow -------------------------------  1.  **Zákazník odošle formulár**          *   na FE sa zobrazí fullscreen overlay „Odosielam žiadosť…“              *   FE okamžite pošle dáta (bez príloh – tie sú už uložené na serveri)          2.  **Backend spracuje dopyt**          *   zostaví email pre firmu:                  *   všetky vyplnené polia (základ + doplnkové)                      *   prílohy pripojené k emailu                  *   odošle email na adresy z `FIRM_EMAILS`          3.  **Ak je odoslanie firme úspešné:**          *   backend odošle **potvrdzujúci email zákazníkovi** (zhrnutie dopytu)              *   backend zmaže prílohy z disku          4.  **Ak nastane chyba pri odosielaní firme:**          *   backend:                  *   zmaže prílohy z disku                      *   odošle zákazníkovi email, že nastala chyba (skúsiť znova / kontaktovať inak)              5.  **Frontend**          *   podľa odpovede API:                  *   zobrazí overlay **Success** (zelená fajka + text)                      *   alebo **Error** (červený stav + odporúčanie)               * * *  🔒 Bezpečnostné odporúčania ---------------------------  *   SMTP:          *   neodporúča sa dlhodobo používať osobný Gmail              *   odporúčaný prechod na dedikovanú SMTP službu (Mailgun, SendGrid, atď.)          *   Uploady:          *   prípadné doplnenie antivírus kontroly (napr. ClamAV)              *   obmedziť typy a veľkosti súborov (už je nastavené)          *   CORS:          *   povoliť len konkrétne domény (`https://geotherm.sk`, `https://geotherm.kikoland.fun`)          *   HTTPS:          *   pravidelná obnova certifikátov (Certbot vie robiť auto-obnovu)          *   Logy:          *   monitorovať `journalctl -u geotherm-api` pri problémoch           * * *  🧰 Údržba a rozšírenia ----------------------  ### Logy backendu  bash  Kopírovať kód  `journalctl -u geotherm-api -n 100 --no-pager`  ### Aktualizácia aplikácie (manuálne)  Na serveri:  bash  Kopírovať kód  `cd /srv/geotherm git pull origin main  cd backend npm install --omit=dev sudo systemctl restart geotherm-api  cd ../frontend npm install npm run build  sudo systemctl reload nginx`  _(toto je vhodné neskôr zautomatizovať cez GitHub Actions + SSH deploy)_  ### Možné budúce rozšírenia  *   admin rozhranie pre prezeranie dopytov v      *   uloženie dopytov do DB (PostgreSQL/MySQL)      *   PDF export dopytu      *   prepojenie s CRM      *   reCAPTCHA (ochrana proti spam botom)      *   logovanie a monitoring (Sentry, atď.)       * * *  © Licencia / vlastníctvo ------------------------  Projekt vytvorený pre **GEOTHERM Slovakia s.r.o.**   Autor implementácie: **Kristián Lančarič**  Použitie, úpravy a ďalší rozvoj sú v kompetencii firmy Geotherm a jej dodávateľov.   ``