# Flash Cards

Web minimalista para estudiar con flashcards en Markdown, con almacenamiento
local en SQLite.

## Requisitos

- Node.js 18+
- [pnpm](https://pnpm.io/) 9+

## Instalación y uso

```bash
pnpm install
pnpm start
```

Abre `http://localhost:3000` en el navegador.

En Windows PowerShell, si la política de ejecución bloquea `pnpm.ps1`, usa
el ejecutable `.cmd` sin modificar la configuración del sistema:

```powershell
pnpm.cmd install
pnpm.cmd start
```

El campo `packageManager` de `package.json` fija pnpm 9.15.9 para que Corepack
y los entornos de CI utilicen la misma versión que generó el lockfile.

La base de datos se guarda en `data/flashcards.db` (se crea automáticamente
la primera vez que se ejecuta el servidor).

## Funcionalidades

- Crear, listar, editar y eliminar flashcards.
- La pregunta/enunciado y la respuesta/información adicional aceptan
  **Markdown**, con vista previa en vivo al editar.
- Mazos (decks) para organizar las tarjetas por tema, con opciones para renombrarlos o eliminarlos.
- Etiquetas reutilizables, seleccionables como chips al crear o editar tarjetas.
- Buscador y filtros combinables por mazo y etiqueta.
- Modo estudio: tarjeta con animación de volteo (pregunta ↔ respuesta),
  navegación anterior/siguiente, atajos de teclado (flechas y espacio) y
  botón para mezclar el orden.
- Modo oscuro/claro (se recuerda entre sesiones).

## Stack

- Backend: Node.js + Express + better-sqlite3.
- Frontend: HTML/CSS/JS sin frameworks, con `marked` (Markdown) y
  `DOMPurify` (sanitizado) servidos localmente.
