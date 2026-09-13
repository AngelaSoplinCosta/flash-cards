# Plan de base de datos y evolución de Flash Cards

Revisión: 12 de septiembre de 2026. Este plan refleja la implementación actual y sustituye los pasos iniciales ya completados.

## Decisión de base de datos

PostgreSQL es el motor único, tanto para uso personal como para una futura versión comercial. El modelo es relacional: un mazo tiene tarjetas, y cada tarjeta puede tener varias etiquetas. SQL permite proteger estas relaciones mediante claves foráneas, restricciones y transacciones. Guardar Markdown como texto no requiere una base documental.

Arquitectura actual: navegador → Express y frontend → PostgreSQL. En desarrollo puedes utilizar Docker; la colección personal ya está en Supabase. El servidor se desplegará en Render siguiendo la [guía de despliegue](DESPLIEGUE-SUPABASE-RENDER.md).

## Trabajo completado

- Configuración mediante DATABASE_URL y pool de conexiones con pg.
- Repositorios asíncronos separados de las rutas HTTP.
- Migraciones PostgreSQL numeradas con historial y bloqueo para ejecuciones simultáneas.
- Validación de entradas, errores controlados, transacciones y relaciones.
- Transferencia de la colección a Supabase y comprobación del contenido.
- Registro, login, contraseñas con hash scrypt y sesiones revocables.
- Colecciones privadas por cuenta, protección CSRF y límites persistentes de intentos.
- Pruebas con PostgreSQL local temporal para CRUD, integridad, concurrencia y autenticación.

La aplicación usa cuentas propias; no integra Supabase Auth. Express verifica las sesiones y aplica la pertenencia de los datos. El esquema flashcards queda fuera de la Data API de Supabase.

## Cómo ejecutar los pasos pendientes

Ejecuta un prompt por cambio revisable, con este contexto:

```text
Trabaja sobre este repositorio Flash Cards: Node.js, Express, PostgreSQL y frontend HTML/CSS/JS. Lee las instrucciones del repositorio y el README. Implementa únicamente el paso indicado. Conserva mis tarjetas, el contrato HTTP y el sanitizado Markdown, y usa pnpm. Verifica el comportamiento afectado con una base PostgreSQL temporal local, sin utilizar mis datos personales. Informa qué cambió, qué verificaste y qué falta.
```

### Paso 1. Completar el despliegue personal

Sigue los pasos de GitHub y Render en la guía existente. La conexión a Supabase y el acceso a la colección ya funcionan.

```text
Revisa la configuración para desplegar el servidor y frontend en Render con PostgreSQL en Supabase. Comprueba instalación con lockfile, HOST, PORT, origen público HTTPS, proxy, registro deshabilitado para uso personal y certificado CA. Prepara un health check y cierre ordenado del servidor y pool si faltan. Documenta las comprobaciones de login, CRUD y persistencia después de reiniciar. Deja la configuración lista para revisar sin crear recursos de pago.
```

Criterio: puedes iniciar sesión desde la URL pública y los datos persisten después de reiniciar el servidor.

### Paso 2. Respaldos y recuperación

```text
Añade un procedimiento reproducible de respaldo PostgreSQL con pg_dump y restauración con pg_restore. Incluye las tablas de la aplicación y el historial de migraciones, sin publicar credenciales. Excluye respaldos de Git y documenta cómo conservar copias fuera del proyecto. Comprueba la restauración en una base temporal local comparando contenido, relaciones y secuencias. No sobrescribas la base personal. Documenta el manejo privado de respaldos que contienen hashes de contraseñas y sesiones.
```

Criterio: existe una copia que se puede restaurar y verificar sin alterar la colección personal.

### Paso 3. Lecturas acotadas y búsquedas

```text
Implementa paginación en GET /api/cards con límite máximo y orden estable por created_at e id. Actualiza el frontend para navegar las páginas y obtener tarjetas del modo estudio por lotes. Conserva filtros combinados, edición, Markdown y aislamiento por usuario. Maneja errores y evita que una búsqueda antigua reemplace resultados recientes. Verifica listas y estudio con más tarjetas que el tamaño de una página.
```

Criterio: lista y estudio funcionan con una colección grande sin descargar todas las tarjetas en cada consulta.

### Paso 4. Preparar una beta comercial

```text
Revisa los flujos de acceso antes de abrir una beta: añade recuperación de contraseña e invitaciones con un mecanismo definido, exportación de la colección propia y verificaciones HTTP para dos cuentas. Conserva o sustituye la autenticación actual únicamente con una estrategia explícita de transición. Comprueba sesiones vencidas, aislamiento, CSRF y Markdown malicioso. Prepara CI con PostgreSQL temporal, sin secretos ni acceso a la base personal. Documenta mantenimiento, disponibilidad y costos del alojamiento usando las condiciones vigentes del proveedor.
```

Criterio: cada cuenta puede recuperar acceso y exportar sus datos, y las pruebas comprueban el aislamiento.

### Paso 5, opcional. Progreso de estudio persistente

```text
Añade study_reviews para eventos de repaso y card_progress para el estado actual, privados por usuario y tarjeta. Guarda valoración, fecha y próximo repaso. Empieza con intervalos sencillos documentados y configurables. Añade acciones Olvidé / Difícil / Bien / Fácil y tarjetas pendientes, conservando la navegación libre. Inserta el evento y actualiza el progreso en una transacción; evita duplicarlo por reintentos. Verifica persistencia, fechas y aislamiento entre cuentas.
```

Criterio: el progreso se conserva entre sesiones y los reintentos no duplican repasos.
