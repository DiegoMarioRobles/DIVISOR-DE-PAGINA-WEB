# La Huella

Portal de noticias especializado en seguridad de la provincia de Buenos
Aires, Argentina. Agrega automáticamente noticias desde feeds RSS de
medios argentinos, las categoriza por tema (Policía Bonaerense,
Narcotráfico, Accidentes, Detenciones, Seguridad Vial, Justicia o
General) y las publica en un sitio público. Incluye un panel de
administración para gestionar noticias, fuentes RSS, publicidades y la
configuración general del sitio.

**Aviso legal sobre el contenido de terceros**: el portal nunca guarda ni
muestra el texto completo de una nota ajena. Solo guarda título, un
resumen breve (máximo 300 caracteres, provisto por el propio feed),
imagen de portada, fecha y fuente. El título y la tarjeta de cada
noticia agregada siempre enlazan a la nota original del medio, en una
pestaña nueva. Las noticias que el administrador cargue manualmente
desde el panel sí pueden tener contenido completo propio.

## Stack

- Backend: Node.js + Express
- Base de datos: SQLite (`better-sqlite3`), un solo archivo (`data.db`)
- Frontend: HTML + CSS + JavaScript vanilla, sin frameworks ni build step
- Lector RSS: `rss-parser`
- Tareas programadas: `node-cron`
- Autenticación: JWT + bcrypt
- Despliegue recomendado: Railway

## Requisitos previos

- [Node.js](https://nodejs.org/) versión 18 o superior (`node -v` para
  comprobarlo).
- npm (se instala junto con Node.js).
- Git.

No hace falta instalar ni configurar ningún motor de base de datos: SQLite
se guarda en un único archivo dentro del proyecto.

## Instalación local, paso a paso

```bash
# 1. Cloná el repositorio y entrá a la carpeta
git clone <URL-de-este-repositorio>
cd DIVISOR-DE-PAGINA-WEB

# 2. Instalá las dependencias
npm install

# 3. Creá tu archivo de variables de entorno a partir del ejemplo
cp .env.example .env

# 4. (Opcional pero recomendado) Editá .env y cambiá JWT_SECRET
#    por un valor propio y aleatorio, por ejemplo con:
openssl rand -hex 64
#    y pegalo como valor de JWT_SECRET dentro de .env

# 5. Levantá el servidor
npm start
```

Si todo salió bien vas a ver en la consola algo como:

```
Usuario administrador inicial creado (usuario: admin, contraseña: seguridad2024). ...
La Huella escuchando en el puerto 3000
Scheduler de RSS iniciado correctamente.
```

- Portal público: [http://localhost:3000](http://localhost:3000)
- Panel de administración: [http://localhost:3000/admin](http://localhost:3000/admin)

La primera vez que arranca, el servidor crea automáticamente el archivo
`data.db` con todas las tablas necesarias y los datos iniciales (usuario
admin, configuración por defecto y una lista de fuentes RSS candidatas,
todas inactivas — ver la sección "Cómo agregar fuentes RSS" más abajo).

## Variables de entorno

Están documentadas también en `.env.example`. Copiá ese archivo a `.env`
y completá los valores reales; `.env` nunca se sube al repositorio.

| Variable | Para qué sirve | Obligatoria |
|---|---|---|
| `PORT` | Puerto donde escucha el servidor Express. En Railway se ignora este valor: la plataforma inyecta su propia variable `PORT` automáticamente. | No (default `3000`) |
| `NODE_ENV` | Informativo (`development` / `production`), útil para los logs. No cambia el comportamiento del servidor. | No |
| `JWT_SECRET` | Secreto usado para firmar y verificar los tokens JWT del panel de administración. **Hay que cambiarlo por un valor largo y aleatorio antes de publicar el sitio** (`openssl rand -hex 64`). Si no se define, el servidor arranca igual con un valor de desarrollo inseguro — nunca dejarlo así en producción. | **Sí, en producción** |
| `DB_PATH` | Ruta del archivo SQLite. Si no se define, se usa `./data.db` en la raíz del proyecto. | No |

## Cómo entrar al panel y cambiar la contraseña

1. Entrá a `http://localhost:3000/admin` (o a tu dominio + `/admin` una
   vez desplegado).
2. Iniciá sesión con las credenciales iniciales:
   - Usuario: `admin`
   - Contraseña: `seguridad2024`

> ⚠️ **Importante**: esta contraseña es solo para el primer ingreso. Es
> pública (está en este mismo README y en el código), así que **cambiala
> inmediatamente** desde **Configuración → Cambiar contraseña** antes de
> publicar el sitio en internet. Mientras no la cambies, cualquiera que
> conozca este proyecto puede entrar a tu panel de administración.

El login tiene un límite de 5 intentos fallidos por IP cada 15 minutos
para dificultar ataques de fuerza bruta.

## Cómo agregar fuentes RSS nuevas

El proyecto viene con una lista de fuentes **candidatas** en
`seeds/fuentes.js`, cargadas automáticamente en la base de datos la
primera vez que arranca el servidor, **todas inactivas**. Ver la sección
"Qué fuentes RSS quedaron funcionando" más abajo para el detalle de por
qué ninguna se pudo verificar durante el desarrollo y cómo validarlas.

Para agregar o activar una fuente, desde el panel:

1. Entrá a **Fuentes RSS** en el menú lateral.
2. Para una fuente ya cargada: hacé clic en **Actualizar ahora** o
   simplemente activala; para una nueva, completá **Agregar fuente**
   con el nombre, la URL del feed y (opcional) el sitio web.
3. Antes de guardar, el panel valida el feed contra
   `POST /api/admin/fuentes/validar` y te muestra una vista previa de
   los primeros 3 títulos que trae. Si la validación falla, no actives
   la fuente hasta encontrar la URL correcta (muchos sitios usan rutas
   como `/rss`, `/feed`, `/rss.xml` o `/rss/<sección>/`).
4. Guardá. La fuente se actualiza sola según el intervalo configurado
   (**Configuración → Intervalo de actualización RSS**, en minutos), o
   podés forzar una lectura inmediata con **Actualizar ahora** /
   **Actualizar todas**.

Ejemplo de una fuente ya validada y activa (formato interno, no hace
falta editar archivos a mano — esto es solo para entender la estructura
que también usa `seeds/fuentes.js`):

```js
{
  nombre: 'Nombre del medio',
  url_rss: 'https://ejemplo.com/rss.xml',
  sitio_web: 'https://ejemplo.com',
  activa: true, // solo después de validarla
}
```

## Cómo subir a Railway, paso a paso

1. Creá una cuenta en [Railway](https://railway.app) si no tenés una, y
   conectá tu cuenta de GitHub.
2. Subí este proyecto a un repositorio de GitHub (si todavía no lo está).
3. En Railway: **New Project → Deploy from GitHub repo** y elegí este
   repositorio.
4. Railway detecta automáticamente que es un proyecto Node.js (usa
   Nixpacks) y toma el comando de arranque de `railway.json` /
   `Procfile` (`node server.js`).
5. En la pestaña **Variables** del servicio, agregá al menos:
   - `JWT_SECRET`: un valor largo y aleatorio (`openssl rand -hex 64`).
   - `NODE_ENV`: `production`.
   - No hace falta definir `PORT`: Railway lo inyecta solo.
6. **Configurá un volumen antes del primer despliegue** (ver la sección
   siguiente) para que la base de datos no se borre en cada deploy.
7. Desplegá. Railway te va a dar una URL pública tipo
   `https://tu-proyecto.up.railway.app`.
8. Entrá a `https://tu-proyecto.up.railway.app/admin` y **cambiá la
   contraseña del admin de inmediato** (ver más arriba).

### Persistencia de SQLite en Railway (muy importante)

Railway, como la mayoría de las plataformas de despliegue basadas en
contenedores, **reinicia el sistema de archivos del contenedor en cada
despliegue**. Si no hacés nada especial, el archivo `data.db` (con todas
las noticias, fuentes, publicidades y usuarios) se pierde cada vez que
subís un cambio.

Para evitarlo, hay que agregar un **volumen persistente**:

1. En el servicio dentro de Railway, andá a la pestaña **Volumes**.
2. Creá un volumen nuevo y montalo, por ejemplo, en `/data`.
3. Agregá la variable de entorno `DB_PATH=/data/data.db` en el servicio,
   para que la aplicación guarde el archivo SQLite dentro de ese volumen
   en vez de en el sistema de archivos efímero del contenedor.
4. Volvé a desplegar. A partir de ahí, `data.db` va a vivir en el
   volumen y va a sobrevivir a los próximos despliegues.

Si en algún momento cambiás de plan o de región en Railway, verificá que
el volumen siga asociado al servicio antes de desplegar.

## Cómo conectar un dominio propio

1. En el servicio de Railway, andá a **Settings → Networking → Custom
   Domain**.
2. Agregá tu dominio (por ejemplo `seguridadbonaerense.com.ar` o un
   subdominio como `noticias.tudominio.com`).
3. Railway te va a mostrar un registro DNS (generalmente un `CNAME`) para
   crear en el panel de tu proveedor de dominios.
4. Cargá ese registro en tu proveedor de DNS y esperá la propagación
   (puede tardar desde minutos hasta un par de horas).
5. Railway emite el certificado HTTPS automáticamente una vez que el DNS
   propagó correctamente.

## Solución de problemas frecuentes

- **"No se pudo validar el feed" / "Status code 403" al validar una
  fuente**: el medio está bloqueando el pedido (a veces por
  `User-Agent`, geobloqueo, o el feed cambió de dirección). Probá abrir
  la URL del feed directamente en el navegador; si tampoco carga ahí, la
  URL cambió o el feed fue discontinuado.
- **El scheduler no actualiza automáticamente**: revisá
  **Configuración → Intervalo de actualización RSS** y los logs del
  servidor (o **Dashboard → últimos registros** en el panel). Un cambio
  de intervalo se aplica sin reiniciar el servidor.
- **Perdí todas las noticias después de un despliegue en Railway**: no
  configuraste un volumen persistente — ver la sección de arriba.
- **Olvidé la contraseña del panel**: no hay recuperación por email en
  esta versión. Hay que entrar directo a la base de datos (`data.db`,
  tabla `usuarios`) y reemplazar `password_hash` por un hash nuevo
  generado con bcrypt, o borrar esa fila para que se recree el usuario
  `admin` con la contraseña por defecto en el próximo arranque.
- **El servidor arranca pero el RSS nunca trae noticias nuevas**: fijate
  si las fuentes están **activas** en el panel — las que vienen
  precargadas arrancan todas inactivas hasta que las valides (ver más
  abajo por qué).
- **Puerto 3000 ocupado en desarrollo local**: definí otro valor de
  `PORT` en tu `.env`.

## Qué quedó construido

- Backend Express completo con todos los endpoints públicos y de admin
  definidos en `CONTRATO.md`, autenticación JWT (8hs de expiración),
  rate limiting en el login, validación de entrada, consultas SQL
  siempre parametrizadas y manejo de errores unificado.
- Base de datos SQLite con migraciones idempotentes y seed inicial
  (usuario admin, configuración por defecto, fuentes RSS candidatas).
- Portal público mobile-first (1/2/3 columnas según el ancho de
  pantalla), con buscador, filtro por categoría, paginación,
  publicidades con métricas de impresiones/clicks, y meta tags Open
  Graph para compartir en redes.
- Panel de administración con tema oscuro: dashboard con gráfico de
  barras dibujado en `<canvas>`, gestión completa de noticias (propias y
  agregadas), fuentes RSS (con validación previa y vista previa),
  publicidades (con CTR calculado) y configuración general del sitio.
- Motor de lectura RSS con deduplicación por link original, extracción
  de imagen con orden de prioridad (`enclosure` → `media:content` →
  `media:thumbnail` → primera `<img>` del contenido → sin imagen),
  recorte de resumen a 300 caracteres sin HTML, aislamiento de fallas
  (una fuente caída no frena a las demás) y categorizador automático por
  palabras clave.

## Comandos exactos para levantarlo

```bash
git clone <URL-de-este-repositorio>
cd DIVISOR-DE-PAGINA-WEB
npm install
cp .env.example .env
npm start
```

Portal: `http://localhost:3000` — Panel: `http://localhost:3000/admin`
(usuario `admin`, contraseña `seguridad2024`, cambiarla de inmediato).

## Qué fuentes RSS quedaron funcionando y cuáles fallaron (y por qué)

**Ninguna fuente pudo verificarse en vivo durante el desarrollo**, no
porque los feeds estén necesariamente rotos, sino porque el entorno de
desarrollo (sandbox de Claude Code) donde se construyó este proyecto
tiene la salida de red bloqueada hacia dominios arbitrarios (se
comprobó el bloqueo — HTTP 403 / "egress blocked" — contra varios
dominios de prueba: `infobae.com`, `diariopopular.com.ar`, `eldia.com`,
`minutouno.com`, tanto con `curl` como con la herramienta de fetch web
disponible). Por política de ese entorno, ninguna petición a un sitio
de noticias argentino pudo completarse, así que **no se pudo confirmar
en vivo que ninguna URL de feed responda XML válido**.

En `seeds/fuentes.js` quedaron 5 candidatos (priorizando medios
provinciales/locales sobre nacionales, tal como se pidió), todos
marcados explícitamente como no verificados y cargados **inactivos**
por defecto:

| Medio | Estado |
|---|---|
| Infobae | No verificado — candidato nacional con buena cobertura de PBA |
| La Nación | No verificado — candidato nacional |
| Clarín - Policiales | No verificado — ruta de feed estimada, puede haber cambiado |
| Diario Popular | No verificado — candidato local/provincial de mayor prioridad |
| El Día (La Plata) | No verificado — candidato local/provincial |

**Una vez desplegado en un entorno con salida a internet normal (como
Railway en producción)**, hay que ir a **Fuentes RSS** en el panel y usar
el botón **Validar fuente** sobre cada una antes de activarla; el
sistema de validación (`POST /api/admin/fuentes/validar`) sí funciona
correctamente (se probó de punta a punta contra un feed RSS local de
prueba durante el desarrollo) — lo único que no pudo probarse fue el
acceso de red hacia los medios reales. Si alguna URL no responde,
probá variantes habituales (`/feed`, `/rss`, `/rss.xml`,
`/rss/<sección>/`) antes de descartar el medio.

## Limitaciones actuales y qué conviene mejorar más adelante

- **Ninguna fuente RSS viene verificada** (ver sección anterior): es lo
  primero que hay que validar apenas se despliegue en un entorno con
  internet real.
- **Sin recuperación de contraseña por email**: si se pierde la
  contraseña del admin, hay que editar la base manualmente (ver
  solución de problemas).
- **Un solo usuario/rol de administrador**: la tabla `usuarios` soporta
  múltiples usuarios y un campo `rol`, pero el panel actual no tiene una
  pantalla para gestionar usuarios adicionales — habría que agregarla si
  se necesitan varios administradores con permisos distintos.
- **Sin subida de imágenes propia**: tanto las noticias propias como las
  publicidades y el logo del portal se cargan como una URL de imagen ya
  alojada en otro lado (no hay un endpoint de subida de archivos al
  servidor). Se podría agregar más adelante con `multer` o un bucket
  externo (S3, Cloudinary, etc.).
- **El intervalo de cron para "cada N minutos" es exacto para minutos
  simples o múltiplos de una hora**: para valores intermedios poco
  habituales se aproxima al múltiplo de hora más cercano (quedó
  documentado con un `console.warn` en `services/scheduler.js`). El
  valor por defecto (30 minutos) no tiene este problema.
- **Vulnerabilidades reportadas por `npm audit`**: hay 5 (2 moderadas, 2
  altas, 1 crítica) en dependencias transitivas de build (`tar`, vía
  `node-pre-gyp`/`bcrypt`, y `uuid`, vía `node-cron`). Son librerías que
  se usan solo al instalar el proyecto o de forma interna, no en rutas
  que reciban datos de un atacante, pero conviene revisar
  `npm audit fix --force` (implica actualizar `bcrypt` y `node-cron` a
  versiones con cambios incompatibles) antes de un uso prolongado en
  producción.
- **Sin tests automatizados** (unitarios/end-to-end): todo el checklist
  de la Fase 2 se probó manualmente contra un servidor real durante el
  desarrollo, pero no quedaron pruebas automatizadas en el repositorio
  para correr en cada cambio futuro.
