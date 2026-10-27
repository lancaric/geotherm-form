**Geotherm – Online Formulár pre Dopyty**

Komplexný systém na odosielanie zákazníckych dopytov vrátane nahrávania príloh, emailových notifikácií, validácie a bezpečnostných opatrení.

**Produkčný testovací server:**\
<https://geotherm.kikoland.fun>

Pripravené na nasadenie na oficiálnu doménu spoločnosti Geotherm Slovakia s.r.o.

-----
**Obsah**

- Architektúra projektu
- Funkcionalita z pohľadu používateľa
- Použité technológie
- Štruktúra priečinkov
- Inštalácia – vývojové prostredie
- Environment variables
- Spustenie vo vývoji
- Build a produkčné nasadenie
- Nginx reverse proxy & SSL
- Pipeline pre upload súborov
- Email notifikácie – workflow
- Bezpečnostné odporúčania
- Údržba a rozšírenia
-----
**Architektúra projektu**

**Frontend**

- React + TypeScript (Vite)
- TailwindCSS (dizajn a layout)
- SPA s pokročilým formulárom (validácia, výber typu stavby, upload príloh, fullscreen overlay)

**Backend**

- Node.js (Express)
- REST API endpointy:
  - POST /api/upload
  - DELETE /api/upload/:id
  - POST /api/form (alebo /api/submit)
- Ukladanie príloh na disk (backend/uploads)
- Odosielanie emailov (SMTP)
- Automatické mazanie príloh po spracovaní

**Nasadenie**

- Ubuntu Server (self-hosted)
- Nginx ako reverse proxy
- systemd služba pre backend
- Let’s Encrypt (Certbot) – HTTPS certifikáty
-----
**Funkcionalita z pohľadu používateľa**

1. Vyplnenie formulára (desktop / mobil).
1. Voliteľné doplnkové technické údaje.
1. Pridanie príloh:
   1. Povolené typy: .pdf, .doc, .docx, .jpg, .jpeg, .png
   1. Max veľkosť: 1 súbor – **15 MB**, celkovo – **40 MB**
1. Automatický upload príloh s progresom a možnosťou zrušenia.
1. Tlačidlo **Odoslať** je aktívne až po úspešnom nahratí všetkých príloh.
1. Po odoslaní sa zobrazí fullscreen overlay a backend spracuje dáta.
1. Email je odoslaný firme a následne zákazníkovi.
1. Všetky prílohy sú zmazané (úspech / neúspech).
-----
**Použité technológie**

**Frontend**

- React 18+
- TypeScript
- Vite
- TailwindCSS

**Backend**

- Node.js (LTS)
- Express
- Nodemailer
- Node FS

**Infra**

- Ubuntu Server
- Nginx
- systemd
- Let’s Encrypt (Certbot)
-----
**Štruktúra priečinkov**

/srv/geotherm

├── backend

│   ├── server.js

│   ├── uploads/

│   ├── package.json

│   └── .env

├── frontend

│   ├── src/

│   ├── dist/

│   ├── package.json

│   └── .env

-----
**Inštalácia – vývojové prostredie**

**1. Klonovanie**

git clone git@github.com: KristoveNohy/geotherm-form.git geotherm-form

cd geotherm-form

**2. Inštalácia závislostí**

cd frontend && npm install

cd ../backend && npm install

-----
**Environment Variables**

**Frontend: frontend/.env**

- Lokálne:
- VITE\_API\_URL=http://localhost:4000
- Produkcia:
- VITE\_API\_URL=/api

Frontend podporuje aj absolútnu URL s koncovým `/api` alebo bez neho. Prefix `/api` pridáva iba raz. Nastavenie sa načítava pri `npm run build`. Aktuálny produkčný postup a diagnostika uploadov sú v [PRE-IT.md](PRE-IT.md).

**Backend: backend/.env**

PORT=4000

FRONTEND\_URL=https://geotherm.kikoland.fun

BACKEND\_URL=https://geotherm.kikoland.fun

SMTP\_HOST=smtp.gmail.com

SMTP\_PORT=587

SMTP\_SECURE=false

SMTP\_USER=xxxxx@gmail.com

SMTP\_PASS=SMTP\_APP\_PASSWORD

FROM\_EMAIL="Geotherm <no-reply@geotherm.sk>"

FIRM\_EMAILS="spacinsky@geotherm.sk, niekto.dalsi@geotherm.sk"

.env súbor nesmie byť vo verejnom repozitári!

-----
**Spustenie vo vývoji**

**Backend**

cd backend

node server.js

\# alebo

nodemon server.js

Backend beží na http://localhost:4000

**Frontend**

cd frontend

npm run dev

Frontend beží na http://localhost:5173

-----
**Build a produkčné nasadenie**

**Frontend**

cd /srv/geotherm/frontend

npm install  # pri prvom nasadení

npm run build

**Backend (systemd)**

Súbor: /etc/systemd/system/geotherm-api.service

[Unit]

Description=Geotherm API

After=network.target

[Service]

WorkingDirectory=/srv/geotherm/backend

ExecStart=/usr/bin/node /srv/geotherm/backend/server.js

Restart=always

Environment=NODE\_ENV=production

StandardOutput=journal

StandardError=journal

User=kristian

Group=kristian

[Install]

WantedBy=multi-user.target

sudo systemctl daemon-reload

sudo systemctl enable geotherm-api

sudo systemctl start geotherm-api

-----
**Nginx reverse proxy & SSL**

**HTTP → HTTPS**

server {

`    `listen 80;

`    `server\_name geotherm.kikoland.fun;

`    `return 301 https://$host$request\_uri;

}

**HTTPS blok**

server {

`    `listen 443 ssl http2;

`    `server\_name geotherm.kikoland.fun;

`    `ssl\_certificate     /etc/letsencrypt/live/geotherm.kikoland.fun/fullchain.pem;

`    `ssl\_certificate\_key /etc/letsencrypt/live/geotherm.kikoland.fun/privkey.pem;

`    `root /srv/geotherm/frontend/dist;

`    `index index.html;

`    `location / {

`        `try\_files $uri $uri/ /index.html;

`    `}

`    `location /api/ {

`        `proxy\_pass http://127.0.0.1:4000;

`        `proxy\_http\_version 1.1;

`        `proxy\_set\_header Host $host;

`        `proxy\_set\_header X-Real-IP $remote\_addr;

`        `proxy\_set\_header X-Forwarded-For $proxy\_add\_x\_forwarded\_for;

`        `proxy\_set\_header X-Forwarded-Proto $scheme;

`        `client\_max\_body\_size 30m;

`    `}

}

-----
**📤 Pipeline pre upload súborov**

1. Upload z FE cez POST /api/upload
1. Progres a kontrola stavov
1. Po odoslaní formulára – backend spracuje, pošle email a zmaže prílohy
-----
**Email notifikácie – Workflow**

1. Zákazník odošle formulár
1. Backend:
   1. Pošle email firme
   1. Po úspechu pošle potvrdenie zákazníkovi
   1. V prípade chyby: upozornenie zákazníkovi
1. Prílohy sú vždy vymazané
-----
**Bezpečnostné odporúčania**

- SMTP: odporúčaný prechod z Gmail na Mailgun / SendGrid
- Uploady: antivírus sken (ClamAV)
- CORS: povolené domény len geotherm.sk
- HTTPS: Certbot auto-obnova
- Monitorovanie: journalctl -u geotherm-api
-----
**Údržba a rozšírenia**

**Logy**

journalctl -u geotherm-api -n 100 --no-pager

**Aktualizácia**

cd /srv/geotherm

git pull origin main

cd backend

npm install --omit=dev

sudo systemctl restart geotherm-api

cd ../frontend

npm install

npm run build

sudo systemctl reload nginx

Možná automatizácia cez GitHub Actions

**Budúce rozšírenia**

- Admin rozhranie
- Ukladanie do DB (PostgreSQL/MySQL)
- PDF export
- reCAPTCHA
- CRM integrácia
- Logovanie (Sentry)
-----

Projekt vytvorený pre **GEOTHERM Slovakia s.r.o.**\
Autor: **Kristián Lančarič**

Použitie, úpravy a ďalší rozvoj sú v kompetencii spoločnosti Geotherm a jej dodávateľov.

