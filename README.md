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

La base de datos se guarda en `data/flashcards.db` (se crea automáticamente
la primera vez que se ejecuta el servidor).

## Funcionalidades

- Crear, listar, editar y eliminar flashcards.
- La pregunta/enunciado y la respuesta/información adicional aceptan
  **Markdown**, con vista previa en vivo al editar.
- Mazos (decks) para organizar las tarjetas por tema.
- Buscador y filtro por mazo en la lista de tarjetas.
- Modo estudio: tarjeta con animación de volteo (pregunta ↔ respuesta),
  navegación anterior/siguiente, atajos de teclado (flechas y espacio) y
  botón para mezclar el orden.
- Modo oscuro/claro (se recuerda entre sesiones).

## Stack

- Backend: Node.js + Express + better-sqlite3.
- Frontend: HTML/CSS/JS sin frameworks, con `marked` (Markdown) y
  `DOMPurify` (sanitizado) servidos localmente.
