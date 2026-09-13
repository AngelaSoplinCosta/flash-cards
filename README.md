# Flash Cards

Web minimalista para estudiar con flashcards en Markdown, con almacenamiento en PostgreSQL.

## Requisitos

- Node.js 18+ y pnpm 9+ (el proyecto fija pnpm 9.15.9).
- PostgreSQL local o remoto. Para la opción local incluida: Docker Desktop iniciado.

En Windows PowerShell puedes usar `pnpm.cmd` si la política de ejecución bloquea `pnpm.ps1`.

## Inicio local

```powershell
pnpm.cmd install
Copy-Item .env.example .env
docker compose up -d db
pnpm.cmd db:migrate
pnpm.cmd start
```

No reemplaces un `.env` que ya hayas configurado. Abre http://localhost:3000.

`compose.yaml` inicia PostgreSQL 17, accesible solo desde tu computadora en el puerto 5432.
La contraseña del ejemplo es exclusivamente para desarrollo local. Los datos se conservan en el volumen Docker `postgres_data`.
`docker compose stop db` lo detiene sin borrar datos; `docker compose up -d db` lo vuelve a iniciar.
No uses `docker compose down -v` si quieres conservar ese volumen.

El servidor carga `.env` con dotenv. Las variables definidas por el alojamiento tienen prioridad.
Si no existe `DATABASE_URL`, el inicio falla con un mensaje explicativo; no vuelve a SQLite.

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | Conexión PostgreSQL, exclusivamente en el backend. |
| `HOST` | Por defecto `127.0.0.1`; en Render configura `0.0.0.0`. |
| `PORT` | Por defecto 3000; en Render utiliza su variable suministrada. |
| `TEST_DATABASE_URL` | Conexión explícita a PostgreSQL local para las pruebas de integración. |

## Migrar tus tarjetas de SQLite

Conserva `data/flashcards.db` hasta comprobar la importación. Instala las dependencias de desarrollo en la computadora desde la que importes: `better-sqlite3` se utiliza solo en este comando y en pruebas, no en el servidor PostgreSQL.

Primero revisa el origen sin conectar ni modificar PostgreSQL:

```powershell
pnpm.cmd db:import-sqlite --dry-run
```

Después, con `DATABASE_URL` apuntando al destino correcto y el servidor de la aplicación detenido:

```powershell
pnpm.cmd db:import-sqlite
pnpm.cmd start
```

Para importar otro archivo:

```powershell
pnpm.cmd db:import-sqlite "C:/ruta/flashcards.db" --dry-run
pnpm.cmd db:import-sqlite "C:/ruta/flashcards.db"
```

La importación:

- Abre SQLite en modo de solo lectura y toma una instantánea transaccional consistente.
- Verifica integridad y compatibilidad de IDs, fechas y texto.
- Importa mazos, tarjetas, etiquetas y asociaciones en una sola transacción PostgreSQL.
- Conserva IDs y Markdown; interpreta las fechas SQLite sin zona horaria como UTC.
- Compara todo el contenido importado y ajusta las secuencias para futuras inserciones.
- Rechaza destinos con datos. Solo admite una base vacía o el mazo inicial General sin tarjetas ni etiquetas.
- Revierte los datos importados si falla. La preparación del esquema puede permanecer aplicada.
- No modifica ni elimina el archivo SQLite original.

El dry-run comprueba únicamente el origen. Los permisos, la conexión y las restricciones del destino se verifican durante la importación real.
Haz la importación antes de usar la aplicación con PostgreSQL: el comando está diseñado para una migración inicial, no para sincronización continua.
Detén la aplicación durante este procedimiento.

## PostgreSQL en Supabase

Para el proceso completo, consulta la [guía de despliegue en Supabase y Render](docs/DESPLIEGUE-SUPABASE-RENDER.md).

1. Crea un proyecto y abre **Connect → Session pooler**.
2. Copia la conexión PostgreSQL al `DATABASE_URL` de tu `.env` o del alojamiento. Utiliza el puerto de session pooler indicado por Supabase; el ejemplo habitual es 5432.
3. Sustituye la contraseña y codifica sus caracteres especiales para una URL.
4. Configura TLS con verificación de certificado. Descarga el certificado CA del proyecto y añade a la URL `sslmode=verify-full&sslrootcert=C:/ruta/supabase-ca.crt` (en Linux, utiliza su ruta local).
5. Ejecuta `pnpm.cmd db:migrate` para una instalación vacía o `pnpm.cmd db:import-sqlite` para transferir tu colección.

El backend utiliza `pg` con un pool de hasta cinco conexiones. No envíes `DATABASE_URL`, contraseñas o certificados privados a `public/`.
El esquema de la aplicación es `flashcards`, separado de `public`; no lo añadas a los esquemas expuestos por la Data API de Supabase.

La aplicación incluye cuentas locales con usuario y contraseña, sesiones en PostgreSQL y colecciones privadas por cuenta. No necesita Cognito ni Supabase Auth. Para publicar configura la autenticación de producción indicada abajo.

## Registro y acceso

Ejecuta `pnpm.cmd start`, abre http://localhost:3000 y selecciona **Crear una cuenta**. El usuario admite de 3 a 32 letras ASCII, números o guiones bajos y no distingue mayúsculas. La contraseña debe tener entre 15 y 128 caracteres; puedes usar una frase larga. No se envían códigos ni correos. Usa un gestor de contraseñas: esta versión todavía no incluye recuperación automática ni MFA.

Las contraseñas se guardan como hashes scrypt con sal aleatoria (`N=131072`, `r=8`, `p=1`), nunca como texto ni cifrado reversible. El servidor limita a dos derivaciones simultáneas para controlar el consumo de memoria. [Recomendaciones OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

Cada cuenta recibe un mazo General privado. Todas las rutas de datos exigen sesión y comprueban el propietario. Las sesiones expiran a los siete días y se revocan al cerrar sesión; sus tokens solo se guardan como hashes en PostgreSQL. Las cookies son HttpOnly y SameSite=Strict, y en producción también Secure con prefijo `__Host-`. Los cambios exigen origen coincidente, cabecera de la aplicación y token CSRF. Hay límites persistentes de 30 intentos por IP y 10 por usuario cada 15 minutos, más 5 registros por IP cada hora. Las sesiones y contadores vencidos se limpian al arrancar y cada 15 minutos.

### Conservar tu colección anterior

Importa SQLite antes de crear cuentas. Los mazos y etiquetas anteriores se conservan sin propietario y no aparecen en la web hasta asignarlos. Después de registrar tu cuenta, detén el servidor y ejecuta:

```powershell
pnpm.cmd auth:claim-legacy tu_usuario
pnpm.cmd start
```

Este comando local asigna toda la colección sin propietario a una cuenta existente; ninguna ruta HTTP permite reclamarla. Conserva tarjetas e IDs. Si hay nombres en conflicto con datos de tu nueva cuenta, revierte la transferencia completa; renombra esos mazos o etiquetas y repite. Solo puede eliminar el mazo General vacío de la nueva cuenta si existe uno anterior con ese nombre. Repetir la asignación sin nuevos datos anteriores no hace cambios.

### Producción

Configura estas variables en Render o en tu alojamiento:

```dotenv
NODE_ENV=production
APP_ORIGIN=https://tu-app.onrender.com
TRUST_PROXY=1
AUTH_ALLOW_REGISTRATION=true
```

`APP_ORIGIN` debe coincidir exactamente con la URL pública, sin `/` final; el servidor falla si falta o no usa HTTPS en producción. `TRUST_PROXY=1` corresponde a un único proxy confiable, como Render: no lo actives para acceso directo ni para otra topología sin revisarla. En local HTTP usa el modo de desarrollo predeterminado. Tras crear tu cuenta, puedes configurar `AUTH_ALLOW_REGISTRATION=false` y reiniciar para impedir nuevas cuentas. Mantén `flashcards` fuera de la Data API de Supabase y conserva la verificación TLS de PostgreSQL.

La autenticación aprovecha el servidor y PostgreSQL existentes, sin tarifa de un proveedor de identidad; sí consume CPU, memoria y almacenamiento. Requiere mantenimiento, actualizaciones y respaldos, y no garantiza inmunidad a ataques. Cognito Lite y Essentials incluyen actualmente 10 000 usuarios activos mensuales gratuitos para acceso directo/social; no es necesario descartarlo por un costo inicial. [Precios de Cognito](https://aws.amazon.com/es/cognito/pricing/).

Referencias: [conexiones Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres), [TLS en node-postgres](https://node-postgres.com/features/ssl).

## Esquema y migraciones

Las tablas `flashcards.decks`, `flashcards.cards`, `flashcards.tags` y `flashcards.card_tags` conservan las claves foráneas, el borrado en cascada y los índices.
Los IDs y conteos siguen siendo números en la API; las fechas se devuelven en ISO 8601 UTC.
Las etiquetas conservan la comparación histórica de SQLite NOCASE: las letras ASCII no distinguen mayúsculas, mientras que los acentos se mantienen.
La búsqueda de tarjetas utiliza `ILIKE`.

Los archivos numerados en `migrations/` se aplican una vez y quedan registrados en `flashcards.schema_migrations`.
Un bloqueo transaccional coordina ejecuciones simultáneas; el esquema inicial y el mazo General se preparan antes de abrir el servidor.
También puedes ejecutar las migraciones con `pnpm.cmd db:migrate`.
No edites una migración ya aplicada: añade un nuevo archivo numerado.
El usuario de la conexión necesita permisos para crear el esquema, las tablas y sus migraciones.

## Verificación

Inicia PostgreSQL local y configura una conexión de pruebas explícita:

```powershell
docker compose up -d db
$env:TEST_DATABASE_URL = 'postgresql://flashcards:flashcards_local@127.0.0.1:5432/flashcards'
pnpm.cmd test
```

Las pruebas crean una base temporal con nombre aleatorio, prueban la API HTTP con PostgreSQL real y eliminan únicamente esa base al terminar.
La cuenta local necesita permisos de creación de bases.
No se modifica tu base `flashcards` ni tu archivo SQLite.
Sin `TEST_DATABASE_URL`, la prueba de integración aparece como omitida; no implica que PostgreSQL haya sido verificado.
Las pruebas rechazan conexiones a hosts remotos.

Se verifican CRUD, filtros, tipos JSON, errores, transacciones, concurrencia, borrados en cascada, protección del último mazo, migración fiel de contenido/secuencias, hashes, sesiones falsas/expiradas/revocadas, aislamiento entre cuentas, CSRF, cookies de producción y límites persistentes entre instancias.

## Funcionalidades

- Crear, listar, editar y eliminar flashcards.
- Preguntas y respuestas en Markdown con vista previa sanitizada.
- Mazos y etiquetas reutilizables.
- Búsqueda y filtros combinados.
- Modo estudio con volteo, navegación, atajos y mezcla.
- Tema claro/oscuro persistente en el navegador.

## Stack

- Backend: Node.js, Express, PostgreSQL (`pg`) y dotenv.
- Frontend: HTML/CSS/JS, `marked` y DOMPurify servidos localmente.
- SQLite (`better-sqlite3`): únicamente herramienta de importación y pruebas.
