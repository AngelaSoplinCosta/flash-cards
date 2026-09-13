# Plan de base de datos y evolución de Flash Cards

Revisión: 12 de septiembre de 2026. Este documento conserva el plan de evolución original. La persistencia ahora utiliza PostgreSQL, con migraciones y un importador de SQLite; consulta el README para ejecutar la implementación actual. La autenticación y el aislamiento entre usuarios siguen pendientes.

## Recomendación

- Uso personal en una computadora: conservar SQLite, que ya está implementado.
- Uso personal desde varios dispositivos: un servidor central puede seguir usando SQLite con disco persistente; PostgreSQL administrado es una alternativa si prefieres una base remota.
- Producto comercial con cuentas individuales: recomiendo PostgreSQL administrado. Para una primera versión, Supabase permite combinar PostgreSQL y autenticación. Mantener Express y el frontend actual evita una reescritura innecesaria.
- Si aprender o desplegar en AWS es un objetivo explícito: PostgreSQL en Amazon RDS es una alternativa. La elección del proveedor no cambia la recomendación de SQL.

El modelo es relacional: un mazo tiene tarjetas y cada tarjeta puede tener varias etiquetas. SQL permite expresar y proteger estas relaciones. Guardar Markdown como texto no requiere una base documental. NoSQL puede servir, pero en este proyecto obligaría a rediseñar relaciones y consultas sin una ventaja demostrada. Tampoco es un requisito para vender el producto.

SQLite puede servir aplicaciones pequeñas; el salto a PostgreSQL se justifica por concurrencia de escritura, varias instancias del backend y necesidades de operación, no por un número arbitrario de usuarios. SQLite admite un escritor a la vez por archivo.

Arquitectura recomendada para la versión comercial: navegador → API Express autenticada → PostgreSQL. Supabase Auth identifica al usuario; Express verifica su identidad y aplica permisos. Si se habilita la Data API de Supabase, también deben existir políticas RLS verificadas. Las conexiones privilegiadas del backend pueden omitir RLS: esas políticas no sustituyen el control de acceso en Express.

## Lo que encontré

| Área | Estado observado | Implicación |
| --- | --- | --- |
| Persistencia | `db.js` utiliza `better-sqlite3` y `data/flashcards.db` | Ya tienes una base SQL real; no se guarda todo en el navegador. |
| Modelo | `decks`, `cards`, `tags`, `card_tags` | Buen punto de partida relacional. |
| Integridad | Claves foráneas, borrado en cascada, índices y transacciones en tarjetas/etiquetas | Conservar estas garantías. |
| API | SQL y rutas juntos en `server.js` | Extraer persistencia facilita migraciones y pruebas. |
| Usuarios | No hay autenticación ni propietario de datos | Todas las rutas trabajan sobre una colección global. |
| Validación | Algunos campos usan `.trim()` sin comprobar el tipo | Ciertos JSON inválidos pueden producir errores del servidor. |
| Lectura | `/api/cards` devuelve todas las coincidencias | Incorporar paginación y adaptar también el modo estudio. |
| Frontend | Markdown sanitizado con DOMPurify | Mantener el sanitizado durante las modificaciones. |
| Búsqueda | Algunas llamadas a `loadCards()` no manejan errores y pueden terminar fuera de orden | Evitar resultados antiguos y errores sin informar. |
| Evolución del esquema | `CREATE TABLE IF NOT EXISTS` al arrancar | No actualiza automáticamente tablas existentes; faltan migraciones versionadas. |
| Operación | No hay scripts de pruebas o respaldo definidos | Añadir recuperación comprobable y verificaciones de flujos importantes. |
| Estudio | La cola vive en memoria del frontend | No existe historial persistente ni repetición espaciada. Es una mejora opcional. |

Comprobaciones realizadas: sintaxis de `server.js`, `db.js` y `public/app.js`; apertura de SQLite en modo de solo lectura; `quick_check` correcto y sin incidencias en `foreign_key_check`. Hay 1 mazo, 8 tarjetas, 8 etiquetas y 16 asociaciones. No ejecuté pruebas HTTP ni una revisión visual en navegador.

## Cómo ejecutar los prompts

Ejecuta uno por conversación o por cambio revisable. Antes de avanzar, comprueba el criterio de finalización. Para uso personal, realiza los pasos 1 a 3. Los pasos 4 a 7 son la ruta comercial; el paso 8 es opcional para ambas rutas.

Añade este contexto a cada prompt:

```text
Trabaja sobre este repositorio Flash Cards: Node.js, Express, better-sqlite3 y frontend HTML/CSS/JS. Lee las instrucciones del repositorio y docs/PLAN-BASE-DE-DATOS.md. Implementa únicamente el paso indicado. Conserva mis tarjetas y las funciones actuales, mantén el sanitizado Markdown y usa pnpm. No reescribas el frontend con otro framework. Comprueba el comportamiento afectado usando una base temporal para las pruebas. Al terminar, informa qué cambió, qué verificaste y qué falta. No publiques el servicio ni ejecutes operaciones destructivas sobre mi base personal.
```

### Paso 1. Configuración y recuperación de datos

```text
Implementa configuración para SQLite y recuperación de datos. Permite definir DATABASE_PATH, HOST y PORT mediante variables de entorno, con valores locales documentados y HOST=127.0.0.1 por defecto. Añade .env.example sin secretos; si usas un cargador de .env, configúralo explícitamente. Conserva la compatibilidad con data/flashcards.db.

Añade un comando pnpm de respaldo consistente mediante la API de backup de better-sqlite3 y documenta restauración con el servidor detenido. No copies únicamente el archivo .db de una base activa en modo WAL. Verifica el respaldo y una restauración en archivos temporales, comparando integridad, conteos y relaciones. Excluye respaldos y secretos de Git. Documenta cómo guardar copias fuera de la carpeta de trabajo y cómo cambiar la ruta sin perder datos.
```

Criterio: puedes crear y recuperar un respaldo verificado; los datos personales siguen intactos y el servidor local escucha en loopback por defecto.

### Paso 2. Separar persistencia y versionar el esquema

```text
Refactoriza server.js para separar la creación de la app, las rutas y los repositorios de mazos, tarjetas y etiquetas. Conserva inicialmente SQLite y el contrato HTTP. Expón una forma de iniciar la app con una base temporal sin abrir el puerto al importarla. Define una interfaz asíncrona sencilla para repositorios, que también pueda implementar PostgreSQL, sin construir un ORM propio.

Introduce migraciones SQLite numeradas y una tabla de versiones. Incluye una estrategia para reconocer la base existente como esquema inicial sin recrear tablas ni borrar contenido. Mantén índices, claves foráneas, transacciones y la creación inicial del mazo General solo cuando corresponda. Verifica tanto una instalación vacía como una copia del esquema existente; arrancar dos veces no debe duplicar datos ni repetir migraciones.
```

Criterio: las funciones actuales siguen funcionando y los cambios futuros del esquema tienen un historial reproducible.

### Paso 3. Validación, errores y lecturas acotadas

```text
Añade validación de cuerpos y parámetros: IDs enteros positivos, tipos de texto, campos obligatorios, longitudes y cantidad/tipo de etiquetas. Evita coerciones inesperadas y errores de .trim() por JSON inválido. Centraliza respuestas de error sin exponer detalles internos; distingue 400, 404, 409 y 500.

Implementa paginación en GET /api/cards con límite máximo y orden estable por created_at e id. Actualiza public/app.js para consumir el contrato nuevo, mostrar navegación de páginas y obtener las tarjetas del modo estudio por lotes sin limitarlo accidentalmente a la primera página. Maneja errores en filtros y estudio, y evita que una búsqueda antigua reemplace los resultados de una búsqueda reciente. Conserva filtros combinados, Markdown y edición.

Añade pruebas de integración con una base temporal para validaciones, CRUD, transacciones de tarjetas/etiquetas, filtros, paginación y borrado en cascada. Documenta los comandos de verificación.
```

Criterio: entradas inválidas reciben errores controlados; lista y estudio funcionan con más tarjetas que el tamaño de una página.

Si solo quieres una herramienta personal, puedes quedarte aquí. Tener PostgreSQL no es necesario para continuar estudiando.

### Paso 4. Preparar PostgreSQL y la migración comercial

```text
Prepara PostgreSQL administrado en Supabase como destino comercial, conservando Express. Añade un repositorio PostgreSQL con pool de conexiones, DATABASE_URL solo en el backend, migraciones SQL y comandos locales reproducibles. SQLite puede mantenerse para el uso personal; no conectes ambos motores en una misma solicitud.

Diseña el esquema privado inicial: profiles con UUID del usuario de Supabase Auth; decks y tags con owner_id; cards vinculadas a un mazo; card_tags con integridad que impida asociar etiquetas de otro propietario. Los nombres únicos deben ser por propietario y tener una normalización explícita para mayúsculas, minúsculas y acentos. Los conteos y la regla de mantener al menos un mazo deben ser por usuario. No añadas mazos públicos, colaboración ni pagos en este paso.

Prepara un comando de migración desde una copia consistente de SQLite a un destino vacío, que requiera el UUID de un usuario real de Supabase Auth. Preserva contenido Markdown, fechas y asociaciones; conserva IDs si es viable o genera un mapa explícito, y ajusta secuencias cuando corresponda. Detecta conflictos de nombres antes de importar. Incluye modo dry-run, validación de conteos/relaciones/contenido y protección contra reimportaciones accidentales. No elimines la base origen ni migres mi base personal automáticamente.

Prueba la implementación con PostgreSQL local y usuarios de prueba compatibles con el esquema de autenticación. Documenta lo que requiere configurar una cuenta externa. Mantén esta versión privada hasta completar autenticación y aislamiento en el siguiente paso.
```

Criterio: el esquema y los repositorios funcionan en PostgreSQL; una copia se puede importar y validar sin pérdida de información.

### Paso 5. Autenticación y aislamiento entre usuarios

```text
Integra Supabase Auth en el frontend para registro, inicio/cierre de sesión y recuperación de acceso. En Express verifica los tokens con el mecanismo oficial del proveedor; no confíes en un JWT solo decodificado ni en un owner_id enviado por el cliente.

En el modo comercial exige sesión en todas las rutas de datos. Obtén el propietario de la identidad verificada y restringe lecturas, modificaciones, borrados, conteos, búsquedas y asociaciones a ese usuario. Valida también pertenencia del mazo y las etiquetas. Crea perfil y mazo inicial sin duplicarlos al iniciar sesión de nuevo, con las transacciones o restricciones necesarias.

Define y prueba RLS y permisos para cualquier tabla accesible por la Data API de Supabase; si no utilizamos esa API, deshabilítala según la configuración oficial y documenta los permisos de la conexión Express. No asumas que RLS protege una conexión privilegiada. Mantén cadenas de conexión y claves secretas fuera de public/; las claves publicables del cliente deben tener los permisos correspondientes.

Conserva el uso local personal como configuración explícita. El modo público debe fallar al arrancar si faltan parámetros de autenticación; no debe recurrir silenciosamente al modo sin sesión.
```

Criterio: dos usuarios distintos tienen colecciones privadas; ninguno puede acceder a los datos del otro alterando IDs o filtros.

### Paso 6. Verificar la versión comercial

```text
Crea y ejecuta verificaciones de integración sobre PostgreSQL temporal para dos usuarios: CRUD completo, búsqueda y filtros, paginación, mazo inicial, nombres iguales entre usuarios y borrado en cascada. Comprueba que no se pueden mover tarjetas a mazos ajenos ni vincular etiquetas ajenas, y que los conteos no revelan datos de otros usuarios. Prueba rutas sin token, con token inválido y expirado.

Verifica permisos RLS directamente si la Data API está habilitada, además de las pruebas de Express. Comprueba migración con caracteres españoles, fechas, Markdown y etiquetas compartidas entre varias tarjetas. Haz una prueba de navegador del flujo registro → crear mazo/tarjeta → estudiar → recargar → cerrar sesión. Comprueba que Markdown malicioso no ejecuta scripts.

Corrige fallos encontrados y documenta qué fue probado realmente. Configura un comando de pruebas y CI reproducible sin credenciales ni acceso a datos personales.
```

Criterio: funcionan los flujos reales y se comprueba tanto el acceso permitido como el acceso denegado entre usuarios.

### Paso 7. Preparar despliegue y una beta privada

```text
Prepara un despliegue reproducible de Express y el frontend con PostgreSQL en Supabase: Dockerfile o configuración equivalente, versión de Node soportada verificada en documentación oficial, instalación pnpm con lockfile y compilación del módulo nativo cuando corresponda. Revisa dependencias y actualizaciones necesarias sin cambios de versión mayores injustificados.

Añade health checks, cierre ordenado del servidor/pool, logs sin tokens o contenido privado, límites de solicitudes y configuración de proxy/HTTPS apropiada al alojamiento elegido. Documenta variables de entorno, URL de redirección de Auth, ejecución de migraciones, respaldo y recuperación de PostgreSQL, y separación de desarrollo y producción. Confirma las condiciones vigentes del proveedor para respaldos, disponibilidad y costos; no supongas que un plan gratuito cubre producción.

Prepara una guía de beta privada con invitaciones, recuperación de acceso y exportación de la colección propia. Deja los archivos y comandos listos para revisión. No publiques automáticamente ni crees recursos de pago. Si decido alojar todo en AWS, adapta este paso a RDS PostgreSQL y un alojamiento del backend, explicitando sus costos operativos.
```

Criterio: puedes revisar una configuración concreta de despliegue, sus costos y su procedimiento de recuperación antes de publicarla.

### Paso 8, opcional. Progreso de estudio persistente

```text
Añade historial de repasos y programación de estudio sin cambiar el CRUD existente. Define study_reviews para eventos y card_progress para el estado actual; en la versión comercial ambos deben ser privados por usuario y tarjeta. Guarda valoración, fecha y próximo repaso, con índices para tarjetas pendientes.

Empieza con una regla sencilla de intervalos documentada y configurable; no la presentes como un algoritmo validado. Añade acciones Olvidé / Difícil / Bien / Fácil, calcula el siguiente repaso en el backend y ofrece un modo de tarjetas pendientes. Inserta evento y actualiza progreso en una transacción; evita duplicar una valoración por reintentos. Conserva el modo de navegación libre. Verifica persistencia al recargar, fechas y aislamiento entre usuarios cuando corresponda.
```

Criterio: el progreso se conserva entre sesiones y los reintentos no duplican repasos.

## Fuentes para la decisión

- [SQLite: usos apropiados y concurrencia](https://www.sqlite.org/whentouse.html).
- [SQLite: respaldo consistente de una base activa](https://www.sqlite.org/backup.html).
- [Supabase: PostgreSQL](https://supabase.com/docs/guides/database/overview) y [autenticación](https://supabase.com/docs/guides/auth).
- [Supabase: seguridad y conexiones directas](https://supabase.com/docs/guides/database/secure-data) y [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
- [Amazon RDS: bases relacionales administradas](https://aws.amazon.com/rds/).
- [AWS: modelado de relaciones en DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-relational-modeling.html).
