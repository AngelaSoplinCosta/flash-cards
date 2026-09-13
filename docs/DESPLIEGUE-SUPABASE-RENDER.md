# Desplegar Flash Cards en Supabase y Render

Guía revisada el 12 de septiembre de 2026. Ya tienes GitHub y el proyecto en Supabase. La conexión TLS está verificada y se importaron 1 mazo, 8 tarjetas, 8 etiquetas y 16 asociaciones, conservando los orígenes locales. Ya registraste tu cuenta y confirmaste que puedes ver la colección al iniciar sesión. El despliegue del servidor en Render sigue pendiente.

Arquitectura: navegador → Express y frontend en Render → PostgreSQL en Supabase. No necesitas un alojamiento separado para el frontend: Express ya sirve `public/`. Docker queda para el desarrollo local; Render ejecutará Node y PostgreSQL estará en Supabase.

## 1. Crear Supabase

1. Abre [Supabase](https://supabase.com/) y regístrate. Puedes utilizar tu cuenta de GitHub.
2. Crea una organización con plan Free si el panel lo solicita.
3. Crea un proyecto, por ejemplo `flashcards-personal`.
4. Define y guarda una contraseña fuerte para la base de datos. Es distinta de tu contraseña de acceso a la aplicación.
5. Escoge una región cercana a la que utilizarás en Render. Para empezar, elige una región de Estados Unidos disponible en ambos proveedores; prioriza que servidor y base queden próximos.
6. Espera a que el proyecto termine de aprovisionarse.

No necesitas crear tablas a mano ni elegir un proyecto de frontend de ejemplo.

El plan gratuito ofrece 500 MB de base y 5 GB de transferencia, y pausa proyectos tras una semana de inactividad. No incluye respaldos automáticos. [Condiciones vigentes](https://supabase.com/pricing).

## 2. Configurar la conexión local a Supabase

1. En el proyecto abre **Connect** y selecciona **Session pooler**.
2. Copia la URI PostgreSQL. Utiliza el host y el puerto que indique ese panel; habitualmente session pooler utiliza 5432.
3. Sustituye el marcador de contraseña por la contraseña de la base. Si contiene caracteres especiales, codifícalos para una URL. No compartas la URI completa en chats, capturas o Git.
4. En Database Settings descarga el certificado CA del proyecto y guárdalo fuera de `public/`, por ejemplo `C:/Users/Demia/.certs/supabase-ca.crt`.
5. Detén tu aplicación con Ctrl+C antes de cambiar su configuración.
6. Guarda una copia de tu configuración local en `.env.local-backup`; este nombre ya está ignorado por Git.

En PowerShell, sin reemplazar una copia anterior:

```powershell
if (-not (Test-Path -LiteralPath .env.local-backup)) {
  Copy-Item -LiteralPath .env -Destination .env.local-backup
}
```

Edita `.env` conservando HOST y PORT locales:

```dotenv
DATABASE_URL=postgresql://postgres.PROJECT_REF:PASSWORD@POOLER_HOST:5432/postgres?sslmode=verify-full&sslrootcert=C:/Users/Demia/.certs/supabase-ca.crt
HOST=127.0.0.1
PORT=3000
```

Este es un ejemplo: sustituye usuario, contraseña, host y ruta por los valores reales. Si tu URI ya tiene parámetros, incorpora las opciones TLS con `&`, sin duplicar `sslmode`.
Si definiste DATABASE_URL en el entorno de la terminal, ese valor tiene prioridad sobre `.env`; elimínalo o actualízalo antes de continuar.

`db.js` carga `.env` y configura `pg`; no hace falta modificar código para cambiar de servidor PostgreSQL. [Conexiones de Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres), [TLS en node-postgres](https://node-postgres.com/features/ssl).

## 3. Comprobar tus tarjetas en Supabase

La colección ya se transfirió y verificó, y confirmaste que aparece al iniciar sesión. Continúa con el despliegue de Render: no necesitas transferirla ni asignarla de nuevo. Los cambios nuevos se guardan en el PostgreSQL configurado en DATABASE_URL.

Para preparar el esquema de otra base PostgreSQL, ejecuta:

```powershell
pnpm.cmd db:migrate
```

Este comando aplica migraciones; no copia datos entre bases. En tu base actual las migraciones ya están aplicadas.

Para revisar los conteos en SQL Editor:

```sql
SELECT
  (SELECT COUNT(*) FROM flashcards.decks) AS decks,
  (SELECT COUNT(*) FROM flashcards.cards) AS cards,
  (SELECT COUNT(*) FROM flashcards.tags) AS tags,
  (SELECT COUNT(*) FROM flashcards.card_tags) AS card_tags;
```

Deja `flashcards` fuera de los esquemas expuestos por la Data API. La aplicación se conecta desde Express y no necesita esa API.

## 4. Preparar acceso privado antes de Render

La aplicación ya incluye registro y login con usuario y contraseña en PostgreSQL, sin códigos por correo. Las cuentas tienen colecciones privadas, contraseñas con hash scrypt, sesiones revocables, protección CSRF y límites persistentes de intentos. Consulta los detalles y la asignación de datos anteriores en [README](../README.md#registro-y-acceso).

En Render configura `NODE_ENV=production`, `APP_ORIGIN=https://tu-app.onrender.com` (sin barra final) y `TRUST_PROXY=1` para su proxy. El servidor exige un origen HTTPS exacto en producción y usa cookies Secure. Tras registrar tu cuenta personal, configura `AUTH_ALLOW_REGISTRATION=false` y reinicia para cerrar el registro público. El formulario de acceso y los archivos estáticos son públicos; las rutas de datos requieren sesión.

No hay recuperación automática de contraseña ni MFA en esta versión. Guarda la contraseña en un gestor. No configures `/healthz` en Render: esa ruta todavía no existe.

## 5. Subir el código a GitHub

El repositorio ya tiene el remoto `origin` configurado como `https://github.com/DanielHervias/flash-cards.git` y la rama actual es `dev`. No necesitas crear otro repositorio ni volver a añadir el remoto. Render puede conectarse a un repositorio privado mediante la autorización de tu cuenta.

Desde la carpeta actual:

```powershell
git status --short
git add .
git diff --cached --stat
git commit -m "Preparar Flash Cards con PostgreSQL para despliegue"
git branch --show-current
```

Después sube la rama que imprimió el último comando:

```powershell
git push -u origin dev
```

Selecciona también `dev` al crear el Web Service en Render. Los comandos de este apartado son instrucciones para ejecutar desde tu terminal; no se ha hecho commit ni push automáticamente.

Antes de confirmar, asegúrate de que no se incluyan `.env`, certificados, respaldos ni `data/`. Están ignorados; `.env.example` sí debe subirse porque contiene ejemplos. GitHub recibe el código, no la base de datos.

## 6. Crear Render y configurar el servidor

1. Regístrate en [Render](https://render.com/) utilizando GitHub si lo prefieres.
2. Abre **New → Web Service**.
3. Conecta GitHub y autoriza el acceso al repositorio `flash-cards`.
4. Selecciona el repositorio y la rama que acabas de subir.
5. Completa la configuración siguiente.

| Campo | Valor para este proyecto |
| --- | --- |
| Runtime / Language | Node |
| Name | Un nombre disponible, por ejemplo `flashcards-personal` |
| Region | Virginia, próxima a tu Supabase en North Virginia |
| Root Directory | Vacío: package.json está en la raíz |
| Build Command | `pnpm install --prod --frozen-lockfile` |
| Start Command | `pnpm start` |
| Instance Type | Free |
| Health Check Path | `/` (comprueba el servidor; no verifica PostgreSQL) |

El build instala dependencias de producción y ejecuta `postinstall` para copiar marked y DOMPurify a `public/vendor`. pnpm está disponible en el runtime Node de Render; el proyecto fija su versión mediante packageManager.

El arranque de server.js aplica migraciones antes de abrir el puerto. Para este plan gratuito no necesitas un pre-deploy command; esa opción de Render corresponde a servicios de pago.

Referencias: [Express en Render](https://render.com/docs/deploy-node-express-app), [herramientas del runtime](https://render.com/docs/native-runtimes), [comandos de despliegue](https://render.com/docs/deploys).

## 7. Variables y certificado en Render

En Environment configura las variables antes del primer despliegue:

| Variable | Valor |
| --- | --- |
| `DATABASE_URL` | URI de Supabase session pooler, con las opciones TLS y la ruta Linux descrita abajo |
| `HOST` | `0.0.0.0` |
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `22.23.1` para usar una versión de la misma rama que tu entorno local |
| `APP_ORIGIN` | `https://tu-app.onrender.com`, sin barra final |
| `TRUST_PROXY` | `1`, para el proxy de Render |
| `AUTH_ALLOW_REGISTRATION` | `false` para tu uso personal: tu cuenta ya está creada en Supabase |

No añadas tu PORT local: deja que Render suministre PORT. No copies DATABASE_URL de Docker: `127.0.0.1` dentro de Render no es tu computadora.

En **Secret Files**, añade el certificado CA con nombre `supabase-ca.crt` y su contenido. Render lo deja disponible en `/etc/secrets/supabase-ca.crt`. Por tanto, el DATABASE_URL de Render debe incluir:

```text
sslmode=verify-full&sslrootcert=/etc/secrets/supabase-ca.crt
```

La ruta Windows de tu `.env` solo sirve en tu computadora. No desactives la verificación TLS para corregir una ruta equivocada; configura el archivo y la ruta correspondiente.

Render permite fijar la versión de Node con NODE_VERSION. Puedes seleccionar otra versión soportada después de verificarla con el proyecto. [Versión de Node](https://render.com/docs/node-version), [variables y Secret Files](https://render.com/docs/configure-environment-variables).

## 8. Desplegar y comprobar persistencia

Cuando el acceso privado ya funcione y toda la configuración esté completa, crea el Web Service. Render comenzará a instalar dependencias y arrancará la aplicación.

En los logs debe aparecer el mensaje de inicio escuchando en `0.0.0.0` y el puerto suministrado por Render. La URL será del tipo `https://NOMBRE.onrender.com`.

Comprueba:

1. Una ventana privada exige autenticación antes de mostrar tus tarjetas.
2. Puedes ver la colección importada, crear y editar una tarjeta y entrar al modo estudio.
3. Después de cerrar y volver a abrir el navegador, los cambios siguen presentes.
4. Después de un reinicio del servicio, los cambios siguen presentes en Supabase.
5. Cerrar sesión impide acceder a `/api/cards`; sin sesión responde 401.

Una vez enlazada la rama, los siguientes push pueden disparar despliegues automáticos según la configuración del servicio. Los datos permanecen en Supabase, separados del proceso Express.

El servidor gratuito de Render se duerme tras 15 minutos sin tráfico y tarda aproximadamente un minuto en despertar. No requiere mantener encendida tu computadora. Las cuotas de horas, transferencia y builds siguen aplicándose. [Límites de Render](https://render.com/docs/free).

## Problemas habituales

| Mensaje o comportamiento | Qué comprobar |
| --- | --- |
| `ENOTFOUND` | Host de la conexión, sin marcadores pendientes |
| `ECONNREFUSED` / `ETIMEDOUT` | Supabase activo y URI/puerto correctos; para IPv4 utiliza session pooler |
| `28P01` | Usuario completo del pooler, contraseña y codificación de caracteres |
| Error de certificado | Certificado CA y ruta de ese entorno; verify-full debe seguir activo |
| `42501` | Permisos para crear y modificar el esquema flashcards |
| «No open ports detected» | HOST=0.0.0.0 y PORT suministrado por Render |
| No aparecen las tarjetas | DATABASE_URL apunta al destino correcto y los mazos pertenecen a tu cuenta |
| Primera apertura lenta | El servicio gratuito de Render está despertando |

## Próximo paso de esta sesión

Guarda los cambios con commit y sube la rama `dev` a GitHub siguiendo el paso 5. Después crea tu cuenta en Render, conecta este repositorio y configura el Web Service según los pasos 6 y 7. No repitas la importación ni la asignación de la colección: ya confirmaste que tus datos aparecen al iniciar sesión.
