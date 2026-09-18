'use strict';

/**
 * Punto de entrada del backend de "La Huella".
 */

require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');

const { ejecutarMigraciones } = require('./database/migraciones');
const rutasPublicas = require('./routes/publico');
const rutasAdmin = require('./routes/admin');
const { manejadorErrores } = require('./middleware/errores');

const PUERTO = process.env.PORT || 3000;

// 1) Migraciones + seed inicial (idempotente, seguro en cada arranque).
ejecutarMigraciones();

const app = express();

// Detrás de un proxy (Railway, Nginx, etc.) para que req.ip / rate
// limiting funcionen correctamente.
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// 2) Estáticos: portal público en "/" y panel de administración en "/admin".
app.use(express.static(path.join(__dirname, 'public')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// 3) API.
app.use('/api/admin', rutasAdmin);
app.use('/api', rutasPublicas);

// 4) 404 para rutas de API no encontradas (con el formato de error unificado).
app.use('/api', (req, res) => {
  res.status(404).json({ error: true, mensaje: 'Recurso no encontrado.', codigo: 404 });
});

// 5) Middleware global de errores (siempre al final).
app.use(manejadorErrores);

app.listen(PUERTO, () => {
  console.log(`La Huella escuchando en el puerto ${PUERTO}`);

  // El motor de RSS lo escribe el Subagente D en paralelo. Si todavía no
  // existe cuando este servidor arranca, no es un error: se loguea una
  // advertencia y el servidor sigue funcionando con normalidad (la
  // integración final la hace el coordinador).
  try {
    // eslint-disable-next-line global-require
    const scheduler = require('./services/scheduler');
    scheduler.iniciar();
    console.log('Scheduler de RSS iniciado correctamente.');
  } catch (err) {
    console.warn(
      'Advertencia: no se pudo iniciar services/scheduler.js (puede que todavía no exista). ' +
        'El servidor sigue funcionando sin actualización automática de RSS. Detalle:',
      err.message
    );
  }
});

module.exports = app;
