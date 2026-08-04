# Nasadenie formulára a ochrany proti spamu

Tento dokument je určený správcovi servera.

## 1. Požiadavky

- Linux server s Node.js LTS, Nginx a systemd
- verejná doména s HTTPS
- SMTP konto na odosielanie e-mailov
- Cloudflare účet; doména nemusí používať Cloudflare DNS ani proxy
- zdrojový kód aplikácie v ľubovoľnom adresári

Backend má počúvať iba lokálne na porte `4000`. Verejne majú byť dostupné iba porty 80 a 443 cez Nginx.

Pred nasadením musí DNS záznam `formular.geotherm.sk` smerovať na verejnú IP adresu cieľového servera. Overenie:

```bash
getent hosts formular.geotherm.sk
```

### Označenie cesty k projektu

V tomto návode `<APP_DIR>` znamená absolútnu cestu ku koreňu odovzdaného projektu – k adresáru, ktorý obsahuje podsložky `backend` a `frontend`. Technik si ju zistí podľa umiestnenia kódu, napríklad:

```bash
find /var/www /srv /opt -maxdepth 4 -type f -name package.json 2>/dev/null
```

Po nájdení projektu môže cestu pre príkazy uložiť do premennej aktuálneho shellu:

```bash
APP_DIR=/skutocna/cesta/ku/geotherm-form
test -f "$APP_DIR/backend/server.js" && test -f "$APP_DIR/frontend/package.json"
```

Druhý príkaz nesmie vypísať chybu. Hodnotu `<APP_DIR>` v systemd a Nginx konfigurácii treba nahradiť skutočnou absolútnou cestou; shellová premenná sa v týchto konfiguračných súboroch automaticky nerozbalí.

## 2. Vytvorenie Turnstile kľúčov

1. Prihláste sa do Cloudflare Dashboardu.
2. Otvorte **Turnstile** a zvoľte **Add widget**.
3. Zadajte názov, napríklad `Geotherm formular`.
4. Pridajte produkčný hostname bez protokolu a cesty: `formular.geotherm.sk`.
5. Zvoľte režim **Managed**.
6. Uložte si dve hodnoty:
   - **Site key** patrí do frontendu,
   - **Secret key** patrí výhradne na backend a nesmie byť vložený do zdrojového kódu ani odoslaný používateľovi.

Pre staging odporúčame samostatný widget a samostatné kľúče.

## 3. Backend

```bash
cd "$APP_DIR/backend"
npm ci --omit=dev
cp .env.example .env
chmod 600 .env
```

Upravte `<APP_DIR>/backend/.env`:

```ini
NODE_ENV=production
PORT=4000
FRONTEND_URL=https://formular.geotherm.sk
BACKEND_URL=https://formular.geotherm.sk
TURNSTILE_SECRET_KEY=PRODUKCNY_SECRET_KEY
FORM_RATE_LIMIT=3
FORM_RATE_WINDOW_MS=900000
UPLOAD_RATE_LIMIT=10
UPLOAD_RATE_WINDOW_MS=900000
TRUST_PROXY=true
SMTP_HOST=smtp.example.sk
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=notifikacie@example.sk
SMTP_PASS=TAJNE_HESLO
FROM_EMAIL=Geotherm <notifikacie@example.sk>
FIRM_EMAILS=obchod@example.sk
RETAIN_UPLOADS=false
```

`TRUST_PROXY=true` je správne iba vtedy, keď je backend dostupný výhradne cez jeden Nginx reverse proxy. Inak ho ponechajte `false`.

Vytvorte alebo skontrolujte `/etc/systemd/system/geotherm-api.service`:

```ini
[Unit]
Description=Geotherm form API
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=<APP_DIR>/backend
EnvironmentFile=<APP_DIR>/backend/.env
ExecStart=/usr/bin/node <APP_DIR>/backend/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Pripravte úložisko a spustite službu:

```bash
sudo mkdir -p "$APP_DIR/backend/uploads"
sudo chown -R www-data:www-data "$APP_DIR/backend/uploads"
sudo systemctl daemon-reload
sudo systemctl enable --now geotherm-api
sudo systemctl status geotherm-api
```

## 4. Frontend

Vytvorte `<APP_DIR>/frontend/.env.production`:

```ini
VITE_API_URL=https://formular.geotherm.sk
VITE_TURNSTILE_SITE_KEY=PRODUKCNY_SITE_KEY
```

`VITE_API_URL` je základná URL bez koncového `/api`. Aplikácia si `/api/form` a `/api/upload` doplní sama. Premenné Vite sa vložia do JavaScriptu počas buildu, preto po každej zmene `.env.production` treba frontend znovu zostaviť.

```bash
cd "$APP_DIR/frontend"
npm ci
npm run build
```

## 5. Nginx

Nasledujúcu konfiguráciu zlúčte s existujúcim HTTPS server blokom. Hodnotu `<APP_DIR>` nahraďte skutočnou cestou ešte pred spustením `nginx -t`:

```nginx
server {
    listen 443 ssl http2;
    server_name formular.geotherm.sk;
    root <APP_DIR>/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 45m;
    }
}
```

Pri `proxy_pass` zámerne nie je koncové `/`; backend musí dostať pôvodnú cestu `/api/...`.

Ak server nastavuje vlastnú Content Security Policy, povoľte `https://challenges.cloudflare.com` v `script-src`, `frame-src` a `connect-src`. Neupravujte ju pridaním druhého konfliktného CSP headera; Cloudflare zdroj doplňte do aktuálnej politiky.

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### Expirovaný alebo chýbajúci certifikát

Ak je aktuálny certifikát expirovaný, najprv skontrolujte DNS, systémový čas a certifikáty evidované Certbotom:

```bash
getent hosts formular.geotherm.sk
timedatectl status
sudo certbot certificates
sudo nginx -t
```

Ak Certbot certifikát pre `formular.geotherm.sk` eviduje, otestujte obnovu bez vydania ostrého certifikátu a až potom vykonajte obnovu:

```bash
sudo certbot renew --dry-run
sudo certbot renew
sudo nginx -t
sudo systemctl reload nginx
```

Ak Certbot certifikát neeviduje alebo pôvodná renewal konfigurácia už nie je použiteľná, po správnom nastavení DNS a dostupnosti portu 80 vydajte a nainštalujte nový certifikát:

```bash
sudo certbot --nginx -d formular.geotherm.sk
```

Nemažte ručne obsah `/etc/letsencrypt`. Po úspešnej oprave overte automatickú obnovu:

```bash
sudo systemctl status certbot.timer
sudo systemctl list-timers | grep certbot
sudo certbot renew --dry-run
```

Nakoniec overte certifikát, ktorý server skutočne poskytuje navonok:

```bash
echo | openssl s_client -connect formular.geotherm.sk:443 -servername formular.geotherm.sk 2>/dev/null | openssl x509 -noout -subject -issuer -dates
curl -Iv https://formular.geotherm.sk
```

Ak Certbot ukazuje nový certifikát, ale verejná doména stále poskytuje starý, skontrolujte `ssl_certificate`/`ssl_certificate_key` v aktívnom Nginx server bloku, výsledok `sudo nginx -T` a prípadný ďalší proxy alebo load balancer pred serverom.

## 6. Automatická kontrola

Backend testy neposielajú skutočné e-maily:

```bash
cd "$APP_DIR/backend"
npm test
```

Očakávaný výsledok je `5 pass, 0 fail`.

```bash
cd "$APP_DIR/frontend"
npm run build
sudo systemctl status geotherm-api
curl -i http://127.0.0.1:4000/api/form
curl -I https://formular.geotherm.sk
```

GET na `/api/form` môže vrátiť 404; týmto sa iba overuje, že backend odpovedá. Platný formulár sa odosiela metódou POST.

## 7. Akceptačný test v prehliadači

1. Otvorte produkčnú stránku v anonymnom okne.
2. V Developer Tools → Network skontrolujte načítanie `challenges.cloudflare.com` bez CSP chyby.
3. Vyplňte formulár testovacími údajmi a malou prílohou.
4. Skontrolujte, že `POST /api/form` vráti HTTP 200 a `success: true`.
5. Overte prijatie e-mailu firmou aj potvrdzujúceho e-mailu zákazníkom.
6. Počas testu sledujte:

```bash
sudo journalctl -u geotherm-api -f
sudo tail -f /var/log/nginx/error.log
```

Negatívne testy:

- zablokovanie `challenges.cloudflare.com` musí znemožniť odoslanie,
- viac než tri odoslania z rovnakej IP za 15 minút má vrátiť HTTP 429,
- požiadavka bez Turnstile tokenu musí vrátiť HTTP 400 a nesmie odoslať email.

Rate limit sa počíta podľa IP adresy a resetuje sa pri reštarte backendu. Pri viacerých Node procesoch je pre spoločný limit potrebné centrálne úložisko, napríklad Redis.

## 8. Najčastejšie chyby

- **Tlačidlo je neaktívne:** chýba `VITE_TURNSTILE_SITE_KEY`, frontend nebol po zmene rebuildnutý alebo Turnstile blokuje CSP/ad blocker.
- **HTTP 400 – overenie proti spamu zlyhalo:** nesúhlasí site key a secret key, widget nepovoľuje hostname alebo token expiroval.
- **HTTP 404 na POST:** `VITE_API_URL` obsahuje `/api`, prípadne Nginx odstraňuje prefix `/api` kvôli koncovému `/` v `proxy_pass`.
- **Všetci používatelia dostávajú HTTP 429:** nesprávne nastavený `TRUST_PROXY` alebo Nginx neposiela `X-Forwarded-For`.
- **Email nepríde:** skontrolujte SMTP údaje, spam priečinok a `journalctl -u geotherm-api`.

V prípade nejasností ma skontaktuje prostrednictvom telefonu alebo emailu.
