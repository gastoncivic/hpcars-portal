# HP CARS Portal v2.0 — Instrucciones de deploy

## 1. Subir archivos al servidor
Reemplazá los siguientes archivos en tu proyecto corriendo:

```
server.js          ← reemplazar
db.js              ← reemplazar
package.json       ← reemplazar
routes/auth.js     ← reemplazar
routes/files.js    ← reemplazar (nuevo)
routes/admin.js    ← reemplazar (nuevo)
routes/tools.js    ← mantener
public/index.html  ← reemplazar
public/dashboard.html ← reemplazar
public/admin.html  ← reemplazar (nuevo)
.env.example       ← copiar y renombrar a .env
```

## 2. Instalar nuevas dependencias
```bash
npm install multer
```

## 3. Configurar .env
```bash
cp .env.example .env
nano .env
# Completá JWT_SECRET, ADMIN_EMAILS, etc.
```

## 4. Reiniciar el servidor
```bash
pm2 restart hpcars
# o
node server.js
```

## 5. Email de Gilda Alejandra
Agregá su email en .env:
```
ADMIN_EMAILS=angelgastoncalvo@gmail.com,EMAIL_DE_GILDA@dominio.com
```

## Próximos pasos
- [ ] OAuth Google: credenciales en Google Console → GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET
- [ ] OAuth Facebook: credenciales en developers.facebook.com
- [ ] Email SMTP: configurar SMTP_HOST/USER/PASS para verificación
- [ ] Paddle: activar cuando tengas API key
